import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';

import type { MonitoringLogger, MonitoringService } from './service.js';
import type {
  Actor,
  AiSettings,
  IncidentRecord,
  MonitorRecord,
  RemediationAction,
  RemediationRecord,
  ServiceRecord,
} from './types.js';

const OUTPUT_LIMIT = 2000;
const EXECUTE_TIMEOUT_MS = 30_000;
/** How long the probes get to see a service recover after a fix, at the least. */
const MIN_VERIFY_MS = 3 * 60_000;

const DEFAULT_AI: AiSettings = {
  enabled: true,
  agentId: null,
  actorUserId: null,
  actorName: null,
  language: null,
};

export class RemediationError extends Error {
  constructor(
    readonly reason:
      | 'INCIDENT_NOT_FOUND'
      | 'REMEDIATION_NOT_FOUND'
      | 'ACTION_UNKNOWN'
      | 'REMEDIATION_OFF'
      | 'REMEDIATION_SUGGEST_ONLY'
      | 'REMEDIATION_IN_PROGRESS'
      | 'INCIDENT_RESOLVED'
      | 'NOT_PENDING',
    message: string,
    readonly status:
      'NOT_FOUND' | 'FAILED_PRECONDITION' | 'ABORTED' = 'FAILED_PRECONDITION',
  ) {
    super(message);
  }
}

/**
 * Fixes for incidents, and the settings of the agent that proposes them.
 *
 * The tiers of a monitor's `remediationLevel` decide what an agent's request does: `off` and `suggest` refuse it (the
 * agent only diagnoses, or lists the fix among its suggestions), `approve` keeps it pending until a person with Manage
 * permission approves, `auto` runs it at once. A person with Manage permission runs a fix directly. Either way the fix is
 * one of the service's own actions, executed here, never something the agent runs; and whether it worked is decided by
 * the probes afterwards, not by the HTTP answer.
 */
export class RemediationService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly monitoring: MonitoringService,
    private readonly logger: MonitoringLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------------------------------------------

  /** Read on `conn` when the caller holds a transaction: on SQLite a second connection would wait for it forever. */
  async aiSettings(conn?: DatabaseConnection): Promise<AiSettings> {
    const row = await (conn ?? this.db)
      .repository<{ key: string; value: Partial<AiSettings> }>('mnSettings')
      .findOne({ filter: { key: 'ai' } });
    return { ...DEFAULT_AI, ...(row?.value ?? {}) };
  }

  async saveAiSettings(
    value: AiSettings,
    userId: string | null,
  ): Promise<AiSettings> {
    await this.db.repository('mnSettings').upsertOne({
      filter: { key: 'ai' },
      create: { key: 'ai', value, updatedById: userId, updatedAt: new Date() },
      update: { value, updatedById: userId, updatedAt: new Date() },
    });
    return value;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Requests and decisions
  // ---------------------------------------------------------------------------------------------------------------

  async listForIncident(incidentId: string): Promise<RemediationRecord[]> {
    return this.db.repository<RemediationRecord>('mnRemediations').findMany({
      filter: { incidentId },
      sort: (s) => s.field('createdAt').desc(),
    });
  }

  /** The fixes an incident's service allows, and the tier its monitor sets. */
  async optionsFor(incident: IncidentRecord): Promise<{
    service: ServiceRecord | null;
    monitor: MonitorRecord | null;
    actions: RemediationAction[];
    level: MonitorRecord['remediationLevel'];
  }> {
    const service = await this.monitoring.getService(incident.serviceId);
    const monitor = incident.monitorId
      ? await this.monitoring.getMonitor(incident.monitorId)
      : null;
    // An incident declared by hand has no monitor to set a tier: an agent may propose, a person decides.
    return {
      service,
      monitor,
      actions: service?.remediations ?? [],
      level: monitor?.remediationLevel ?? 'approve',
    };
  }

  /** Asks for one of the service's fixes, as an agent's run or as a person with Manage permission. */
  async request(input: {
    incidentId: string;
    actionKey: string;
    reason: string;
    actor: Actor;
    runId?: string | null;
  }): Promise<RemediationRecord> {
    const incident = await this.monitoring.getIncident(input.incidentId);
    if (!incident)
      throw new RemediationError(
        'INCIDENT_NOT_FOUND',
        'The incident does not exist.',
        'NOT_FOUND',
      );
    if (incident.status === 'resolved')
      throw new RemediationError(
        'INCIDENT_RESOLVED',
        'The incident is already resolved; nothing to fix.',
      );
    const { actions, level } = await this.optionsFor(incident);
    const action = actions.find(
      (candidate) => candidate.key === input.actionKey,
    );
    if (!action)
      throw new RemediationError(
        'ACTION_UNKNOWN',
        actions.length
          ? `Unknown action ${input.actionKey}. This service allows: ${actions.map((a) => a.key).join(', ')}.`
          : 'This service defines no remediation actions.',
      );
    const byAgent = input.actor.type === 'agent';
    if (byAgent && level === 'off')
      throw new RemediationError(
        'REMEDIATION_OFF',
        'Remediation is off for this monitor: diagnose only, and change nothing.',
      );
    if (byAgent && level === 'suggest')
      throw new RemediationError(
        'REMEDIATION_SUGGEST_ONLY',
        'This monitor only takes suggestions: list the fix in your diagnosis instead of requesting it.',
      );

    const active = await this.db
      .repository<RemediationRecord>('mnRemediations')
      .exists({
        filter: (f) =>
          f.and([
            f.string('incidentId').eq(incident.id),
            f.or(
              ['pending', 'running', 'verifying'].map((status) =>
                f.string('status').eq(status),
              ),
            ),
          ]),
      });
    if (active)
      throw new RemediationError(
        'REMEDIATION_IN_PROGRESS',
        'A fix for this incident is already pending, running or being verified.',
        'ABORTED',
      );

    const now = new Date();
    const runsNow = !byAgent || level === 'auto';
    const { record } = await this.db
      .repository<RemediationRecord>('mnRemediations')
      .createOne({
        values: {
          id: this.monitoring.newId(),
          incidentId: incident.id,
          serviceId: incident.serviceId,
          monitorId: incident.monitorId,
          actionKey: action.key,
          actionTitle: action.title,
          reason: input.reason,
          status: runsNow ? 'running' : 'pending',
          requestedByType: byAgent ? 'agent' : 'user',
          requestedByName: input.actor.name,
          runId: input.runId ?? null,
          decidedById: byAgent ? null : input.actor.id,
          decidedByName: byAgent ? (runsNow ? 'auto' : null) : input.actor.name,
          decidedAt: runsNow ? now : null,
          executedAt: null,
          httpStatus: null,
          output: null,
          verifyAt: null,
          verifiedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      });
    await this.monitoring.postIncidentUpdate(incident.id, {
      body: runsNow
        ? `Applying fix “${action.title}”. Reason: ${input.reason}`
        : `Fix “${action.title}” is waiting for approval. Reason: ${input.reason}`,
      publicVisible: false,
      actor: input.actor,
      kind: 'remediation',
    });
    if (runsNow) return this.execute(record, action);
    this.monitoring.announce({
      type: 'remediation.awaitingApproval',
      incident,
      remediation: record,
    });
    return record;
  }

  async approve(id: string, actor: Actor): Promise<RemediationRecord> {
    const record = await this.pending(id);
    const incident = await this.monitoring.getIncident(record.incidentId);
    const { actions } = incident
      ? await this.optionsFor(incident)
      : { actions: [] };
    const action = actions.find(
      (candidate) => candidate.key === record.actionKey,
    );
    if (!incident || incident.status === 'resolved' || !action) {
      await this.update(record.id, {
        status: 'rejected',
        decidedById: actor.id,
        decidedByName: actor.name,
        decidedAt: new Date(),
      });
      throw new RemediationError(
        'NOT_PENDING',
        'The incident was resolved or the action was removed since the request; it was withdrawn.',
      );
    }
    const approved = await this.update(record.id, {
      status: 'running',
      decidedById: actor.id,
      decidedByName: actor.name,
      decidedAt: new Date(),
    });
    await this.monitoring.postIncidentUpdate(record.incidentId, {
      body: `Approved fix “${record.actionTitle}”.`,
      publicVisible: false,
      actor,
      kind: 'remediation',
    });
    return this.execute(approved, action);
  }

  async reject(
    id: string,
    actor: Actor,
    note?: string,
  ): Promise<RemediationRecord> {
    const record = await this.pending(id);
    const rejected = await this.update(record.id, {
      status: 'rejected',
      decidedById: actor.id,
      decidedByName: actor.name,
      decidedAt: new Date(),
    });
    await this.monitoring.postIncidentUpdate(record.incidentId, {
      body: `Rejected fix “${record.actionTitle}”.${note ? ` ${note}` : ''}`,
      publicVisible: false,
      actor,
      kind: 'remediation',
    });
    return rejected;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Execution and verification
  // ---------------------------------------------------------------------------------------------------------------

  private async execute(
    record: RemediationRecord,
    action: RemediationAction,
  ): Promise<RemediationRecord> {
    const system: Actor = { type: 'system', id: null, name: 'NocoMonitor' };
    let httpStatus: number | null = null;
    let output: string;
    let ok = false;
    try {
      const response = await this.fetchImpl(action.url, {
        method: action.method,
        headers: action.headers ?? undefined,
        body: action.method === 'GET' ? undefined : (action.body ?? undefined),
        signal: AbortSignal.timeout(EXECUTE_TIMEOUT_MS),
        redirect: 'manual',
      });
      httpStatus = response.status;
      output = (await response.text()).slice(0, OUTPUT_LIMIT);
      ok = response.ok;
    } catch (error) {
      output = error instanceof Error ? error.message : String(error);
    }
    const now = new Date();
    if (!ok) {
      this.logger.warn(
        { remediationId: record.id, httpStatus },
        'A remediation action failed',
      );
      const failed = await this.update(record.id, {
        status: 'failed',
        executedAt: now,
        httpStatus,
        output,
      });
      await this.monitoring.postIncidentUpdate(record.incidentId, {
        body: `Fix “${record.actionTitle}” failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}: ${output.slice(0, 300)}`,
        publicVisible: false,
        actor: system,
        kind: 'remediation',
      });
      return failed;
    }
    const monitor = record.monitorId
      ? await this.monitoring.getMonitor(record.monitorId)
      : null;
    const window = Math.max(
      MIN_VERIFY_MS,
      monitor
        ? monitor.intervalSec * 1000 * (monitor.recoveryThreshold + 1)
        : 0,
    );
    const applied = await this.update(record.id, {
      status: 'verifying',
      executedAt: now,
      httpStatus,
      output,
      verifyAt: new Date(now.getTime() + window),
    });
    const incident = await this.monitoring.getIncident(record.incidentId);
    await this.monitoring.postIncidentUpdate(record.incidentId, {
      body: `Applied fix “${record.actionTitle}” (HTTP ${httpStatus}). The probes will confirm whether the service recovers.`,
      status:
        incident && incident.status !== 'resolved' ? 'monitoring' : undefined,
      publicVisible:
        incident?.status !== 'resolved' && incident?.publicVisible === true,
      actor: system,
      kind: 'remediation',
    });
    return applied;
  }

  /**
   * Settles fixes whose verification window has passed: the service recovered (the incident is resolved, or its
   * monitor is up), or it did not, in which case the incident goes back to investigating for people to take over.
   */
  async verifyDue(now = new Date()): Promise<number> {
    const due = await this.db
      .repository<RemediationRecord>('mnRemediations')
      .findMany({
        filter: (f) =>
          f.and([
            f.string('status').eq('verifying'),
            f.date('verifyAt').notAfter(now),
          ]),
        limit: 50,
      });
    const system: Actor = { type: 'system', id: null, name: 'NocoMonitor' };
    for (const record of due) {
      const incident = await this.monitoring.getIncident(record.incidentId);
      const monitor = record.monitorId
        ? await this.monitoring.getMonitor(record.monitorId)
        : null;
      const recovered =
        incident?.status === 'resolved' ||
        monitor?.status === 'up' ||
        monitor?.status === 'degraded';
      const settled = await this.update(record.id, {
        status: recovered ? 'verified' : 'unverified',
        verifiedAt: now,
      });
      if (!incident || incident.status === 'resolved') continue;
      if (!recovered)
        this.monitoring.announce({
          type: 'remediation.notRecovered',
          incident,
          remediation: settled,
        });
      await this.monitoring.postIncidentUpdate(record.incidentId, {
        body: recovered
          ? `The probes confirm the service responds again after “${record.actionTitle}”.`
          : `The service is still failing after “${record.actionTitle}”. Escalating: a person needs to take over.`,
        status: recovered ? undefined : 'investigating',
        publicVisible: false,
        actor: system,
        kind: 'remediation',
      });
    }
    return due.length;
  }

  /** When an incident resolves, the fixes being verified for it worked. */
  async settleResolved(incidentId: string): Promise<void> {
    await this.db
      .query()
      .updateTable('mnRemediations')
      .set({
        status: 'verified',
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where('incidentId', '=', incidentId)
      .where('status', '=', 'verifying')
      .execute();
  }

  private async pending(id: string): Promise<RemediationRecord> {
    const record = await this.db
      .repository<RemediationRecord>('mnRemediations')
      .findOne({ filter: { id } });
    if (!record)
      throw new RemediationError(
        'REMEDIATION_NOT_FOUND',
        'The fix request does not exist.',
        'NOT_FOUND',
      );
    if (record.status !== 'pending')
      throw new RemediationError(
        'NOT_PENDING',
        `The fix request is already ${record.status}.`,
      );
    return record;
  }

  private async update(
    id: string,
    values: Partial<RemediationRecord>,
  ): Promise<RemediationRecord> {
    const { record } = await this.db
      .repository<RemediationRecord>('mnRemediations')
      .updateOne({
        filter: { id },
        values: { ...values, updatedAt: new Date() },
      });
    return record;
  }
}
