import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { DatabaseManager } from '@nocobase/db';

import type { MonitoringEvent, MonitoringService } from './service.js';
import type {
  DrillSettings,
  IncidentRecord,
  IncidentUpdateRecord,
  RemediationRecord,
} from './types.js';

/** The drill's monitor is checked this often (the shortest interval a monitor may have), so a drill takes minutes. */
const DRILL_INTERVAL_SEC = 20;

const IDLE: DrillSettings = {
  token: null,
  serviceId: null,
  monitorId: null,
  healthy: false,
  startedAt: null,
  completedOnce: false,
};

/** The names and the runbook of the drill's records, in the operators' language. */
export interface DrillWording {
  serviceName: string;
  serviceDescription: string;
  monitorName: string;
  actionTitle: string;
  actionDescription: string;
  runbook: string;
}

export interface DrillStatus {
  state: 'idle' | 'running' | 'recovered';
  serviceId: string | null;
  monitorId: string | null;
  incidentId: string | null;
  startedAt: Date | null;
  detectedAt: Date | null;
  aiState: IncidentRecord['aiState'] | null;
  diagnosedAt: Date | null;
  fix: {
    status: RemediationRecord['status'];
    requestedAt: Date;
    actionTitle: string;
  } | null;
  recoveredAt: Date | null;
  /** The last check could not reach the target at all: the server cannot reach its own URL. */
  targetUnreachable: boolean;
  targetUrl: string | null;
  completedOnce: boolean;
}

/**
 * The drill: a test service, owned by NocoMonitor, whose health check NocoMonitor serves itself at a URL guarded by a
 * random token. Starting a drill makes the check fail, so the probes open a real incident, the agent diagnoses it and
 * asks for the service's one fix, `recover`, which a person approves; the fix makes the check answer again and the
 * probes resolve the incident. Ending the drill deletes everything it created, so it never counts in statistics.
 */
export class DrillService {
  constructor(
    private readonly db: DatabaseManager,
    private readonly monitoring: MonitoringService,
    /** The drill's names, in the operators' language. */
    private readonly wording: () => Promise<DrillWording>,
  ) {}

  async settings(): Promise<DrillSettings> {
    const row = await this.db
      .repository<{ key: string; value: Partial<DrillSettings> }>('mnSettings')
      .findOne({ filter: { key: 'drill' } });
    return { ...IDLE, ...(row?.value ?? {}) };
  }

  private async save(value: DrillSettings): Promise<void> {
    await this.db.repository('mnSettings').upsertOne({
      filter: { key: 'drill' },
      create: { key: 'drill', value, updatedAt: new Date() },
      update: { value, updatedAt: new Date() },
    });
  }

  /** The service a running drill uses, to keep it out of statistics; null when no drill runs. */
  async serviceId(): Promise<string | null> {
    return (await this.settings()).serviceId;
  }

  /**
   * Starts a drill against `apiUrl`, the application's API as the server itself reaches it (such as
   * `https://monitor.example.com/main/api`). A drill already running is ended first: one drill at a time.
   */
  async start(apiUrl: string): Promise<DrillStatus> {
    const wording = await this.wording();
    const current = await this.settings();
    if (current.token) await this.end();
    const token = randomBytes(24).toString('base64url');
    const base = `${apiUrl.replace(/\/+$/u, '')}/monitoringDrill/${token}`;
    const service = await this.monitoring.createService({
      name: wording.serviceName,
      slug: `nocomonitor-drill-${this.monitoring.newId()}`,
      description: wording.serviceDescription,
      groupName: null,
      repoUrl: null,
      runbook: wording.runbook,
      remediations: [
        {
          key: 'recover',
          title: wording.actionTitle,
          description: wording.actionDescription,
          method: 'POST',
          url: `${base}/recover`,
          headers: null,
          body: null,
        },
      ],
      sortOrder: -1,
    });
    // Saved before the monitor exists, so its first check already finds the target failing.
    await this.save({
      ...current,
      token,
      serviceId: service.id,
      monitorId: null,
      healthy: false,
      startedAt: new Date().toISOString(),
    });
    const monitor = await this.monitoring.createMonitor({
      serviceId: service.id,
      name: wording.monitorName,
      type: 'http',
      region: null,
      url: `${base}/health`,
      method: 'GET',
      headers: null,
      body: null,
      expectedStatus: '200-299',
      keyword: null,
      jsonPath: null,
      jsonExpected: null,
      intervalSec: DRILL_INTERVAL_SEC,
      timeoutMs: 5000,
      degradedLatencyMs: null,
      failureThreshold: 1,
      recoveryThreshold: 1,
      enabled: true,
      autoDiagnose: true,
      remediationLevel: 'approve',
      sortOrder: 0,
    });
    await this.save({
      ...(await this.settings()),
      monitorId: monitor.id,
    });
    return this.status();
  }

  /** Ends the drill, deleting its service with its monitor, checks, incidents, fixes and updates. */
  async end(): Promise<void> {
    const current = await this.settings();
    const serviceId = current.serviceId;
    if (serviceId) {
      if (current.monitorId)
        await this.monitoring.deleteMonitor(current.monitorId);
      await this.db.transaction(async (conn) => {
        const incidents = await conn
          .repository<IncidentRecord>('mnIncidents')
          .findMany({ filter: { serviceId } });
        const ids = incidents.map((incident) => incident.id);
        if (ids.length)
          await conn.query
            .deleteFrom('mnIncidentUpdates')
            .where('incidentId', 'in', ids)
            .execute();
        await conn.query
          .deleteFrom('mnRemediations')
          .where('serviceId', '=', serviceId)
          .execute();
        await conn.query
          .deleteFrom('mnIncidents')
          .where('serviceId', '=', serviceId)
          .execute();
      });
      await this.monitoring.deleteService(serviceId);
    }
    await this.save({ ...IDLE, completedOnce: current.completedOnce });
  }

  /** What the drill target answers: `null` for a wrong token, else whether it is healthy. */
  async target(token: string): Promise<{ healthy: boolean } | null> {
    const current = await this.settings();
    if (!current.token || !sameToken(current.token, token)) return null;
    return { healthy: current.healthy };
  }

  /** The drill's one fix: the target answers again. False for a wrong token. */
  async recover(token: string): Promise<boolean> {
    const current = await this.settings();
    if (!current.token || !sameToken(current.token, token)) return false;
    await this.save({ ...current, healthy: true });
    return true;
  }

  /** A drill whose incident resolved counts as completed, for getting started. */
  async handle(event: MonitoringEvent): Promise<void> {
    if (event.type !== 'incident.resolved') return;
    const current = await this.settings();
    if (current.serviceId !== event.incident.serviceId || current.completedOnce)
      return;
    await this.save({ ...current, completedOnce: true });
  }

  async status(): Promise<DrillStatus> {
    const current = await this.settings();
    const idle: DrillStatus = {
      state: 'idle',
      serviceId: null,
      monitorId: null,
      incidentId: null,
      startedAt: null,
      detectedAt: null,
      aiState: null,
      diagnosedAt: null,
      fix: null,
      recoveredAt: null,
      targetUnreachable: false,
      targetUrl: null,
      completedOnce: current.completedOnce,
    };
    if (!current.token || !current.serviceId) return idle;
    const serviceId = current.serviceId;

    const [incident] = await this.db
      .repository<IncidentRecord>('mnIncidents')
      .findMany({
        filter: { serviceId },
        sort: (s) => s.field('startedAt').desc(),
        limit: 1,
      });
    const monitor = current.monitorId
      ? await this.monitoring.getMonitor(current.monitorId)
      : null;
    let diagnosedAt: Date | null = null;
    let fix: DrillStatus['fix'] = null;
    if (incident) {
      const [diagnosis] = await this.db
        .repository<IncidentUpdateRecord>('mnIncidentUpdates')
        .findMany({
          filter: { incidentId: incident.id, kind: 'diagnosis' },
          sort: (s) => s.field('createdAt').asc(),
          limit: 1,
        });
      diagnosedAt = diagnosis ? new Date(diagnosis.createdAt) : null;
      const [remediation] = await this.db
        .repository<RemediationRecord>('mnRemediations')
        .findMany({
          filter: { incidentId: incident.id },
          sort: (s) => s.field('createdAt').desc(),
          limit: 1,
        });
      fix = remediation
        ? {
            status: remediation.status,
            requestedAt: new Date(remediation.createdAt),
            actionTitle: remediation.actionTitle,
          }
        : null;
    }
    const recoveredAt =
      incident?.status === 'resolved' && incident.resolvedAt
        ? new Date(incident.resolvedAt)
        : null;
    return {
      ...idle,
      state: recoveredAt ? 'recovered' : 'running',
      serviceId,
      monitorId: current.monitorId,
      incidentId: incident?.id ?? null,
      startedAt: current.startedAt ? new Date(current.startedAt) : null,
      detectedAt: incident ? new Date(incident.startedAt) : null,
      aiState: incident?.aiState ?? null,
      diagnosedAt,
      fix,
      recoveredAt,
      // A check that got no HTTP answer at all could not reach the target; a 503 is the drill working.
      targetUnreachable:
        !incident &&
        monitor !== null &&
        monitor.lastCheckedAt !== null &&
        monitor.lastHttpStatus === null,
      targetUrl: monitor?.url.replace(current.token, '…') ?? null,
    };
  }
}

function sameToken(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
