import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import type { FilterBuilder } from '@nocobase/repository-input';
import type { IdGeneratorService } from '@nocobase/snowflake';

import { probe } from './probe.js';
import type {
  Actor,
  CheckRecord,
  CheckStatus,
  DailyStatRecord,
  IncidentRecord,
  IncidentSeverity,
  IncidentStatus,
  IncidentUpdateKind,
  IncidentUpdateRecord,
  MonitorRecord,
  MonitorStatus,
  ProbeResult,
  ServiceRecord,
  StatusPageRecord,
} from './types.js';

/** The pino-style subset of the application logger the service uses: context first, then the message. */
export interface MonitoringLogger {
  info(context: object, message?: string): void;
  warn(context: object, message?: string): void;
  error(context: object, message?: string): void;
}

/** Things that happened, for whoever reacts to them: notifications, agents, realtime. */
export type MonitoringEvent =
  | {
      type: 'incident.opened';
      incident: IncidentRecord;
      monitor: MonitorRecord | null;
    }
  | { type: 'incident.resolved'; incident: IncidentRecord }
  | {
      type: 'monitor.statusChanged';
      monitor: MonitorRecord;
      from: MonitorStatus;
      to: MonitorStatus;
    };

export type MonitoringListener = (
  event: MonitoringEvent,
) => void | Promise<void>;

export interface CheckOutcome {
  monitor: MonitorRecord;
  check: CheckRecord;
  openedIncident: IncidentRecord | null;
  resolvedIncident: IncidentRecord | null;
}

/** The overall state of one service, from the states of its monitors. */
export type ServiceHealth =
  | 'operational'
  | 'degraded'
  | 'partialOutage'
  | 'majorOutage'
  | 'maintenance'
  | 'unknown';

export interface UptimeDay {
  day: string;
  total: number;
  up: number;
  degraded: number;
  down: number;
  /** Fraction of checks that answered (up or degraded), or null when nothing was checked that day. */
  uptime: number | null;
  avgLatencyMs: number | null;
}

const SYSTEM: Actor = { type: 'system', id: null, name: 'NocoMonitor' };
const PROBE_CONCURRENCY = 6;
const DAY_MS = 86_400_000;

export function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function lastDays(count: number, now: Date): string[] {
  const days: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1)
    days.push(utcDay(new Date(now.getTime() - index * DAY_MS)));
  return days;
}

/** A service is down when all its monitors are down, partly down when some are. */
export function serviceHealth(
  statuses: readonly MonitorStatus[],
): ServiceHealth {
  const active = statuses.filter((status) => status !== 'paused');
  if (active.length === 0) return statuses.length ? 'maintenance' : 'unknown';
  const down = active.filter((status) => status === 'down').length;
  if (down === active.length) return 'majorOutage';
  if (down > 0) return 'partialOutage';
  if (active.some((status) => status === 'degraded')) return 'degraded';
  if (active.every((status) => status === 'pending')) return 'unknown';
  return 'operational';
}

/** The next monitor status after one check, with the counters that decided it. */
export function nextMonitorState(
  monitor: Pick<
    MonitorRecord,
    | 'status'
    | 'consecutiveFailures'
    | 'consecutiveSuccesses'
    | 'failureThreshold'
    | 'recoveryThreshold'
  >,
  result: CheckStatus,
): {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
} {
  if (result === 'down') {
    const failures = monitor.consecutiveFailures + 1;
    const confirmed = failures >= Math.max(1, monitor.failureThreshold);
    return {
      status: confirmed
        ? 'down'
        : monitor.status === 'pending'
          ? 'pending'
          : monitor.status,
      consecutiveFailures: failures,
      consecutiveSuccesses: 0,
    };
  }
  const successes = monitor.consecutiveSuccesses + 1;
  // A monitor that is down stays down until enough consecutive successes confirm the recovery.
  const recovering =
    monitor.status === 'down' &&
    successes < Math.max(1, monitor.recoveryThreshold);
  return {
    status: recovering ? 'down' : result,
    consecutiveFailures: 0,
    consecutiveSuccesses: successes,
  };
}

export class MonitoringService {
  private readonly listeners = new Set<MonitoringListener>();
  private readonly running = new Set<string>();

  constructor(
    private readonly db: DatabaseManager,
    private readonly ids: IdGeneratorService,
    private readonly logger: MonitoringLogger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  on(listener: MonitoringListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: MonitoringEvent): void {
    for (const listener of this.listeners) {
      Promise.resolve()
        .then(() => listener(event))
        .catch((error: unknown) =>
          this.logger.error(
            {
              event: event.type,
              error: error instanceof Error ? error.message : String(error),
            },
            'A monitoring listener failed',
          ),
        );
    }
  }

  newId(): string {
    return this.ids.generateString();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Probing
  // ---------------------------------------------------------------------------------------------------------------

  /** Probes every enabled monitor whose next check is due. Answers how many were probed. */
  async runDueChecks(now = new Date(), limit = 100): Promise<number> {
    const due = await this.db.repository<MonitorRecord>('mnMonitors').findMany({
      filter: (f) =>
        f.and([
          f.boolean('enabled').isTrue(),
          f.or([
            f.date('nextCheckAt').empty(),
            f.date('nextCheckAt').notAfter(now),
          ]),
        ]),
      sort: (s) => s.field('nextCheckAt').asc(),
      limit,
    });
    const pending = due.filter((monitor) => !this.running.has(monitor.id));
    let index = 0;
    const worker = async () => {
      while (index < pending.length) {
        const monitor = pending[index++];
        try {
          await this.checkMonitor(monitor.id, now);
        } catch (error) {
          this.logger.error(
            {
              monitorId: monitor.id,
              error: error instanceof Error ? error.message : String(error),
            },
            'Checking a monitor failed',
          );
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PROBE_CONCURRENCY, pending.length) },
        worker,
      ),
    );
    return pending.length;
  }

  /** Probes one monitor now and records the result, whatever its schedule says. */
  async checkMonitor(
    monitorId: string,
    now = new Date(),
  ): Promise<CheckOutcome | null> {
    if (this.running.has(monitorId)) return null;
    this.running.add(monitorId);
    try {
      const monitor = await this.getMonitor(monitorId);
      if (!monitor) return null;
      // Claim the next slot before probing, so a slow probe is not started again by the next tick.
      await this.db.repository<MonitorRecord>('mnMonitors').updateOne({
        filter: { id: monitor.id },
        values: {
          nextCheckAt: new Date(now.getTime() + monitor.intervalSec * 1000),
        },
      });
      const result = await probe(monitor, this.fetchImpl);
      return await this.recordResult(monitor.id, result, new Date());
    } finally {
      this.running.delete(monitorId);
    }
  }

  /** Stores a probe result and moves the monitor and its incidents to their next state. */
  async recordResult(
    monitorId: string,
    result: ProbeResult,
    checkedAt: Date,
  ): Promise<CheckOutcome | null> {
    const events: MonitoringEvent[] = [];
    const outcome = await this.db.transaction(async (conn) => {
      const monitors = conn.repository<MonitorRecord>('mnMonitors');
      const monitor = await monitors.findOne({ filter: { id: monitorId } });
      if (!monitor) return null;

      const { record: check } = await conn
        .repository<CheckRecord>('mnChecks')
        .createOne({
          values: {
            id: this.newId(),
            monitorId,
            checkedAt,
            status: result.status,
            latencyMs: result.latencyMs,
            httpStatus: result.httpStatus,
            error: result.error,
            details: result.details,
          },
        });
      await this.addToDailyStats(conn, monitorId, checkedAt, result);

      const previous = monitor.status;
      const next = nextMonitorState(monitor, result.status);
      const changed = next.status !== previous;
      const { record: updated } = await monitors.updateOne({
        filter: { id: monitorId },
        values: {
          status: next.status,
          consecutiveFailures: next.consecutiveFailures,
          consecutiveSuccesses: next.consecutiveSuccesses,
          lastCheckedAt: checkedAt,
          lastLatencyMs: result.latencyMs,
          lastHttpStatus: result.httpStatus,
          lastError: result.error,
          ...(changed ? { statusChangedAt: checkedAt } : {}),
          updatedAt: new Date(),
        },
      });
      if (changed)
        events.push({
          type: 'monitor.statusChanged',
          monitor: updated,
          from: previous,
          to: next.status,
        });

      let openedIncident: IncidentRecord | null = null;
      let resolvedIncident: IncidentRecord | null = null;
      const open = await this.findOpenIncident(conn, monitorId);
      if (next.status === 'down' && previous !== 'down') {
        if (!open) {
          openedIncident = await this.createIncident(conn, {
            serviceId: monitor.serviceId,
            monitorId,
            title: `${monitor.name} is down`,
            severity: 'major',
            source: 'auto',
            body: `Automatically detected: ${result.error ?? 'the check failed'} (${next.consecutiveFailures} consecutive failures).`,
            actor: SYSTEM,
            startedAt: checkedAt,
          });
          events.push({
            type: 'incident.opened',
            incident: openedIncident,
            monitor: updated,
          });
        } else {
          await this.addUpdate(conn, open.id, {
            kind: 'system',
            body: `The monitor failed again: ${result.error ?? 'the check failed'}.`,
            actor: SYSTEM,
          });
        }
      } else if (previous === 'down' && next.status !== 'down' && open) {
        if (open.source === 'auto') {
          resolvedIncident = await this.setIncidentStatus(
            conn,
            open,
            'resolved',
            {
              body: `The monitor recovered after ${next.consecutiveSuccesses} consecutive successful checks.`,
              actor: SYSTEM,
              publicVisible: true,
            },
          );
          events.push({
            type: 'incident.resolved',
            incident: resolvedIncident,
          });
        } else {
          await this.addUpdate(conn, open.id, {
            kind: 'system',
            body: 'The monitor is answering again. The incident stays open until someone resolves it.',
            actor: SYSTEM,
          });
        }
      }
      return { monitor: updated, check, openedIncident, resolvedIncident };
    });
    for (const event of events) this.emit(event);
    return outcome;
  }

  private async addToDailyStats(
    conn: DatabaseConnection,
    monitorId: string,
    at: Date,
    result: ProbeResult,
  ) {
    const day = utcDay(at);
    const stats = conn.repository<DailyStatRecord>('mnDailyStats');
    const existing = await stats.findOne({ filter: { monitorId, day } });
    const latency = result.latencyMs ?? 0;
    const counted =
      result.latencyMs !== null && result.status !== 'down' ? 1 : 0;
    if (!existing) {
      await stats.createOne({
        values: {
          id: this.newId(),
          monitorId,
          day,
          total: 1,
          upCount: result.status === 'up' ? 1 : 0,
          degradedCount: result.status === 'degraded' ? 1 : 0,
          downCount: result.status === 'down' ? 1 : 0,
          latencySum: counted ? latency : 0,
          latencyCount: counted,
        },
      });
      return;
    }
    await stats.updateOne({
      filter: { id: existing.id },
      values: {
        total: { increment: 1 },
        upCount: { increment: result.status === 'up' ? 1 : 0 },
        degradedCount: { increment: result.status === 'degraded' ? 1 : 0 },
        downCount: { increment: result.status === 'down' ? 1 : 0 },
        latencySum: { increment: counted ? latency : 0 },
        latencyCount: { increment: counted },
      },
    });
  }

  /** Deletes raw checks older than the retention window; the daily rollup keeps their totals. */
  async pruneChecks(retentionDays: number, now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - retentionDays * DAY_MS);
    const result = await this.db
      .query()
      .deleteFrom('mnChecks')
      .where('checkedAt', '<', before)
      .execute();
    return result.deletedCount ?? 0;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------------------------------------------------

  private async findOpenIncident(conn: DatabaseConnection, monitorId: string) {
    return conn.repository<IncidentRecord>('mnIncidents').findOne({
      filter: (f) =>
        f.and([
          f.string('monitorId').eq(monitorId),
          f.string('status').ne('resolved'),
        ]),
      sort: (s) => s.field('startedAt').desc(),
    });
  }

  async createIncident(
    conn: DatabaseConnection,
    input: {
      serviceId: string;
      monitorId: string | null;
      title: string;
      severity: IncidentSeverity;
      source: 'auto' | 'manual';
      body: string;
      actor: Actor;
      startedAt?: Date;
      publicVisible?: boolean;
      status?: IncidentStatus;
    },
  ): Promise<IncidentRecord> {
    const now = new Date();
    const status = input.status ?? 'investigating';
    const { record } = await conn
      .repository<IncidentRecord>('mnIncidents')
      .createOne({
        values: {
          id: this.newId(),
          serviceId: input.serviceId,
          monitorId: input.monitorId,
          title: input.title,
          status,
          severity: input.severity,
          source: input.source,
          publicVisible: input.publicVisible ?? true,
          startedAt: input.startedAt ?? now,
          resolvedAt: null,
          aiState: 'none',
          createdById: input.actor.type === 'user' ? input.actor.id : null,
          createdAt: now,
          updatedAt: now,
        },
      });
    await this.addUpdate(conn, record.id, {
      kind: 'status',
      status,
      body: input.body,
      actor: input.actor,
      publicVisible: true,
    });
    return record;
  }

  async addUpdate(
    conn: DatabaseConnection,
    incidentId: string,
    input: {
      kind: IncidentUpdateKind;
      body: string;
      actor: Actor;
      status?: IncidentStatus | null;
      publicVisible?: boolean;
    },
  ): Promise<IncidentUpdateRecord> {
    const { record } = await conn
      .repository<IncidentUpdateRecord>('mnIncidentUpdates')
      .createOne({
        values: {
          id: this.newId(),
          incidentId,
          kind: input.kind,
          status: input.status ?? null,
          body: input.body,
          authorType: input.actor.type,
          authorId: input.actor.id,
          authorName: input.actor.name,
          publicVisible: input.publicVisible ?? false,
          createdAt: new Date(),
        },
      });
    return record;
  }

  async setIncidentStatus(
    conn: DatabaseConnection,
    incident: IncidentRecord,
    status: IncidentStatus,
    input: { body: string; actor: Actor; publicVisible?: boolean },
  ): Promise<IncidentRecord> {
    const now = new Date();
    const { record } = await conn
      .repository<IncidentRecord>('mnIncidents')
      .updateOne({
        filter: { id: incident.id },
        values: {
          status,
          resolvedAt: status === 'resolved' ? now : null,
          updatedAt: now,
        },
      });
    await this.addUpdate(conn, incident.id, {
      kind: 'status',
      status,
      body: input.body,
      actor: input.actor,
      publicVisible: input.publicVisible ?? true,
    });
    return record;
  }

  /** Opens an incident by hand. */
  async openManualIncident(input: {
    serviceId: string;
    monitorId: string | null;
    title: string;
    severity: IncidentSeverity;
    body: string;
    publicVisible: boolean;
    actor: Actor;
  }): Promise<IncidentRecord> {
    const incident = await this.db.transaction((conn) =>
      this.createIncident(conn, { ...input, source: 'manual' }),
    );
    const monitor = input.monitorId
      ? await this.getMonitor(input.monitorId)
      : null;
    this.emit({ type: 'incident.opened', incident, monitor });
    return incident;
  }

  /** Posts an update; with `status`, moves the incident to it. */
  async postIncidentUpdate(
    incidentId: string,
    input: {
      body: string;
      status?: IncidentStatus;
      publicVisible: boolean;
      actor: Actor;
    },
  ): Promise<{ incident: IncidentRecord; update: IncidentUpdateRecord }> {
    const events: MonitoringEvent[] = [];
    const result = await this.db.transaction(async (conn) => {
      const incident = await conn
        .repository<IncidentRecord>('mnIncidents')
        .findOne({ filter: { id: incidentId } });
      if (!incident) throw new IncidentNotFoundError(incidentId);
      if (input.status && input.status !== incident.status) {
        const updated = await this.setIncidentStatus(
          conn,
          incident,
          input.status,
          input,
        );
        if (input.status === 'resolved')
          events.push({ type: 'incident.resolved', incident: updated });
        const update = await conn
          .repository<IncidentUpdateRecord>('mnIncidentUpdates')
          .findOne({
            filter: { incidentId },
            sort: (s) => s.field('createdAt').desc(),
          });
        return { incident: updated, update: update! };
      }
      const update = await this.addUpdate(conn, incidentId, {
        kind: 'note',
        body: input.body,
        actor: input.actor,
        publicVisible: input.publicVisible,
      });
      return { incident, update };
    });
    for (const event of events) this.emit(event);
    return result;
  }

  async updateIncident(
    incidentId: string,
    values: Partial<
      Pick<IncidentRecord, 'title' | 'severity' | 'publicVisible'>
    >,
  ): Promise<IncidentRecord> {
    const repo = this.db.repository<IncidentRecord>('mnIncidents');
    if (!(await repo.exists({ filter: { id: incidentId } })))
      throw new IncidentNotFoundError(incidentId);
    const { record } = await repo.updateOne({
      filter: { id: incidentId },
      values: { ...values, updatedAt: new Date() },
    });
    return record;
  }

  /** Records what an agent concluded about an incident, and adds it to the timeline. */
  async recordDiagnosis(
    incidentId: string,
    input: {
      summary: string;
      rootCause: string | null;
      confidence: string | null;
      suggestedActions: unknown[];
      actor: Actor;
    },
  ): Promise<IncidentRecord> {
    return this.db.transaction(async (conn) => {
      const repo = conn.repository<IncidentRecord>('mnIncidents');
      const incident = await repo.findOne({ filter: { id: incidentId } });
      if (!incident) throw new IncidentNotFoundError(incidentId);
      const now = new Date();
      const { record } = await repo.updateOne({
        filter: { id: incidentId },
        values: {
          aiState: 'completed',
          aiSummary: input.summary,
          aiRootCause: input.rootCause,
          aiConfidence: input.confidence,
          aiSuggestedActions: input.suggestedActions,
          aiUpdatedAt: now,
          updatedAt: now,
        },
      });
      const lines = [input.summary];
      if (input.rootCause) lines.push('', `Root cause: ${input.rootCause}`);
      if (input.confidence) lines.push(`Confidence: ${input.confidence}`);
      await this.addUpdate(conn, incidentId, {
        kind: 'diagnosis',
        body: lines.join('\n'),
        actor: input.actor,
      });
      return record;
    });
  }

  async setAiState(
    incidentId: string,
    values: Partial<Pick<IncidentRecord, 'aiState' | 'aiRunId'>>,
  ) {
    await this.db.repository<IncidentRecord>('mnIncidents').updateOne({
      filter: { id: incidentId },
      values: { ...values, aiUpdatedAt: new Date(), updatedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------------------------------------------

  async getMonitor(id: string): Promise<MonitorRecord | null> {
    return (
      (await this.db
        .repository<MonitorRecord>('mnMonitors')
        .findOne({ filter: { id } })) ?? null
    );
  }

  async getService(id: string): Promise<ServiceRecord | null> {
    return (
      (await this.db
        .repository<ServiceRecord>('mnServices')
        .findOne({ filter: { id } })) ?? null
    );
  }

  async getIncident(id: string): Promise<IncidentRecord | null> {
    return (
      (await this.db
        .repository<IncidentRecord>('mnIncidents')
        .findOne({ filter: { id } })) ?? null
    );
  }

  async listServices(): Promise<ServiceRecord[]> {
    return this.db.repository<ServiceRecord>('mnServices').findMany({
      sort: (s) => [s.field('sortOrder').asc(), s.field('name').asc()],
    });
  }

  async listMonitors(serviceId?: string): Promise<MonitorRecord[]> {
    return this.db.repository<MonitorRecord>('mnMonitors').findMany({
      ...(serviceId ? { filter: { serviceId } } : {}),
      sort: (s) => [s.field('sortOrder').asc(), s.field('name').asc()],
    });
  }

  async listIncidentUpdates(
    incidentId: string,
    publicOnly = false,
  ): Promise<IncidentUpdateRecord[]> {
    return this.db
      .repository<IncidentUpdateRecord>('mnIncidentUpdates')
      .findMany({
        filter: publicOnly
          ? { incidentId, publicVisible: true }
          : { incidentId },
        sort: (s) => s.field('createdAt').desc(),
      });
  }

  /** The updates of several incidents in one query, newest first, grouped by incident. */
  async listUpdatesFor(
    incidentIds: readonly string[],
    publicOnly: boolean,
  ): Promise<Map<string, IncidentUpdateRecord[]>> {
    const grouped = new Map<string, IncidentUpdateRecord[]>(
      incidentIds.map((id) => [id, []]),
    );
    if (!incidentIds.length) return grouped;
    const rows = await this.db
      .repository<IncidentUpdateRecord>('mnIncidentUpdates')
      .findMany({
        filter: (f) =>
          f.and([
            f.or(incidentIds.map((id) => f.string('incidentId').eq(id))),
            ...(publicOnly ? [f.boolean('publicVisible').isTrue()] : []),
          ]),
        sort: (s) => s.field('createdAt').desc(),
      });
    for (const row of rows) grouped.get(row.incidentId)?.push(row);
    return grouped;
  }

  /** Checks of one monitor since a time, oldest first, for latency charts. */
  async listChecks(
    monitorId: string,
    since: Date,
    limit = 2000,
  ): Promise<CheckRecord[]> {
    const rows = await this.db.repository<CheckRecord>('mnChecks').findMany({
      filter: (f) =>
        f.and([
          f.string('monitorId').eq(monitorId),
          f.date('checkedAt').notBefore(since),
        ]),
      sort: (s) => s.field('checkedAt').desc(),
      limit,
    });
    return rows.reverse();
  }

  /**
   * Daily uptime of several monitors over the last `days` days, combined per key: `groupOf` maps a monitor to the key
   * it counts toward (itself, or its service). One query, whatever the number of monitors.
   */
  async uptimeByDay(
    monitorIds: readonly string[],
    days: number,
    groupOf: (monitorId: string) => string,
    now = new Date(),
  ): Promise<Map<string, UptimeDay[]>> {
    const range = lastDays(days, now);
    const result = new Map<string, Map<string, UptimeDay>>();
    if (monitorIds.length) {
      const rows = await this.db
        .query()
        .selectFrom('mnDailyStats')
        .select([
          'monitorId',
          'day',
          'total',
          'upCount',
          'degradedCount',
          'downCount',
          'latencySum',
          'latencyCount',
        ])
        .where('monitorId', 'in', monitorIds)
        .where('day', '>=', range[0])
        .execute<DailyStatRecord>();
      for (const row of rows) {
        const key = groupOf(row.monitorId);
        const byDay =
          result.get(key) ??
          new Map<
            string,
            UptimeDay & { latencySum: number; latencyCount: number }
          >();
        const current = (byDay.get(row.day) as
          | (UptimeDay & { latencySum: number; latencyCount: number })
          | undefined) ?? {
          day: row.day,
          total: 0,
          up: 0,
          degraded: 0,
          down: 0,
          uptime: null,
          avgLatencyMs: null,
          latencySum: 0,
          latencyCount: 0,
        };
        current.total += Number(row.total);
        current.up += Number(row.upCount);
        current.degraded += Number(row.degradedCount);
        current.down += Number(row.downCount);
        current.latencySum += Number(row.latencySum);
        current.latencyCount += Number(row.latencyCount);
        byDay.set(row.day, current);
        result.set(key, byDay);
      }
    }
    const answer = new Map<string, UptimeDay[]>();
    const keys = new Set(monitorIds.map(groupOf));
    for (const key of keys) {
      const byDay = result.get(key);
      answer.set(
        key,
        range.map((day) => {
          const entry = byDay?.get(day) as
            | (UptimeDay & { latencySum: number; latencyCount: number })
            | undefined;
          if (!entry || entry.total === 0)
            return {
              day,
              total: 0,
              up: 0,
              degraded: 0,
              down: 0,
              uptime: null,
              avgLatencyMs: null,
            };
          return {
            day,
            total: entry.total,
            up: entry.up,
            degraded: entry.degraded,
            down: entry.down,
            uptime: (entry.up + entry.degraded) / entry.total,
            avgLatencyMs: entry.latencyCount
              ? Math.round(entry.latencySum / entry.latencyCount)
              : null,
          };
        }),
      );
    }
    return answer;
  }

  async getStatusPage(slug: string): Promise<StatusPageRecord | null> {
    return (
      (await this.db
        .repository<StatusPageRecord>('mnStatusPages')
        .findOne({ filter: { slug } })) ?? null
    );
  }

  /** Incidents of some services that are open, or were resolved after `since`. */
  async incidentsForServices(
    serviceIds: readonly string[],
    since: Date,
    publicOnly: boolean,
  ): Promise<IncidentRecord[]> {
    if (!serviceIds.length) return [];
    const rows = await this.db
      .repository<IncidentRecord>('mnIncidents')
      .findMany({
        filter: (f) =>
          f.and([
            f.or(serviceIds.map((id) => f.string('serviceId').eq(id))),
            ...(publicOnly ? [f.boolean('publicVisible').isTrue()] : []),
            f.or([
              f.string('status').ne('resolved'),
              f.date('resolvedAt').notBefore(since),
            ]),
          ]),
        sort: (s) => s.field('startedAt').desc(),
        limit: 200,
      });
    return rows;
  }

  /** Incidents for the administration list, newest first, a page at a time. */
  async listIncidents(input: {
    state: 'open' | 'resolved' | 'all';
    serviceId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: IncidentRecord[]; total: number }> {
    const repo = this.db.repository<IncidentRecord>('mnIncidents');
    const where = (f: IncidentFilterBuilder) =>
      f.and([
        ...(input.state === 'open' ? [f.string('status').ne('resolved')] : []),
        ...(input.state === 'resolved'
          ? [f.string('status').eq('resolved')]
          : []),
        ...(input.serviceId ? [f.string('serviceId').eq(input.serviceId)] : []),
      ]);
    const [rows, total] = await Promise.all([
      repo.findMany({
        filter: where,
        sort: (s) => s.field('startedAt').desc(),
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      }),
      repo.count({ filter: where }),
    ]);
    return { rows, total };
  }

  async listStatusPages(): Promise<StatusPageRecord[]> {
    return this.db
      .repository<StatusPageRecord>('mnStatusPages')
      .findMany({ sort: (s) => s.field('title').asc() });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Catalog writes
  // ---------------------------------------------------------------------------------------------------------------

  async createService(values: ServiceInput): Promise<ServiceRecord> {
    const now = new Date();
    const { record } = await this.db
      .repository<ServiceRecord>('mnServices')
      .createOne({
        values: { ...values, id: this.newId(), createdAt: now, updatedAt: now },
      });
    return record;
  }

  async updateService(
    id: string,
    values: Partial<ServiceInput>,
  ): Promise<ServiceRecord | null> {
    const repo = this.db.repository<ServiceRecord>('mnServices');
    if (!(await repo.exists({ filter: { id } }))) return null;
    const { record } = await repo.updateOne({
      filter: { id },
      values: { ...values, updatedAt: new Date() },
    });
    return record;
  }

  /** Deletes a service with no monitors left; answers false when it still has some. */
  async deleteService(
    id: string,
  ): Promise<'deleted' | 'notFound' | 'hasMonitors'> {
    return this.db.transaction(async (conn) => {
      const repo = conn.repository<ServiceRecord>('mnServices');
      if (!(await repo.exists({ filter: { id } }))) return 'notFound';
      if (
        await conn
          .repository<MonitorRecord>('mnMonitors')
          .exists({ filter: { serviceId: id } })
      )
        return 'hasMonitors';
      await repo.deleteOne({ filter: { id } });
      return 'deleted';
    });
  }

  async createMonitor(values: MonitorInput): Promise<MonitorRecord> {
    const now = new Date();
    const { record } = await this.db
      .repository<MonitorRecord>('mnMonitors')
      .createOne({
        values: {
          ...values,
          id: this.newId(),
          status: values.enabled ? 'pending' : 'paused',
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          nextCheckAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
    return record;
  }

  async updateMonitor(
    id: string,
    values: Partial<MonitorInput>,
  ): Promise<MonitorRecord | null> {
    const repo = this.db.repository<MonitorRecord>('mnMonitors');
    const current = await repo.findOne({ filter: { id } });
    if (!current) return null;
    const pausing = values.enabled === false && current.enabled;
    const resuming = values.enabled === true && !current.enabled;
    const { record } = await repo.updateOne({
      filter: { id },
      values: {
        ...values,
        ...(pausing ? { status: 'paused', statusChangedAt: new Date() } : {}),
        ...(resuming
          ? {
              status: 'pending',
              statusChangedAt: new Date(),
              consecutiveFailures: 0,
              consecutiveSuccesses: 0,
            }
          : {}),
        // A changed target or schedule is checked again soon rather than at the old slot.
        nextCheckAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return record;
  }

  /** Deletes a monitor with its checks and rollups; its incidents stay, detached, for the record. */
  async deleteMonitor(id: string): Promise<boolean> {
    return this.db.transaction(async (conn) => {
      const repo = conn.repository<MonitorRecord>('mnMonitors');
      if (!(await repo.exists({ filter: { id } }))) return false;
      await conn.query
        .deleteFrom('mnChecks')
        .where('monitorId', '=', id)
        .execute();
      await conn.query
        .deleteFrom('mnDailyStats')
        .where('monitorId', '=', id)
        .execute();
      await conn.query
        .updateTable('mnIncidents')
        .set({ monitorId: null })
        .where('monitorId', '=', id)
        .execute();
      await repo.deleteOne({ filter: { id } });
      return true;
    });
  }

  async createStatusPage(values: StatusPageInput): Promise<StatusPageRecord> {
    const now = new Date();
    const { record } = await this.db
      .repository<StatusPageRecord>('mnStatusPages')
      .createOne({
        values: { ...values, id: this.newId(), createdAt: now, updatedAt: now },
      });
    return record;
  }

  async updateStatusPage(
    id: string,
    values: Partial<StatusPageInput>,
  ): Promise<StatusPageRecord | null> {
    const repo = this.db.repository<StatusPageRecord>('mnStatusPages');
    if (!(await repo.exists({ filter: { id } }))) return null;
    const { record } = await repo.updateOne({
      filter: { id },
      values: { ...values, updatedAt: new Date() },
    });
    return record;
  }

  async deleteStatusPage(id: string): Promise<boolean> {
    const repo = this.db.repository<StatusPageRecord>('mnStatusPages');
    if (!(await repo.exists({ filter: { id } }))) return false;
    await repo.deleteOne({ filter: { id } });
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Overviews
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Every service with its monitors, health and daily uptime, plus the open incidents: what the dashboard and a status
   * page show. A fixed number of queries whatever the number of services.
   */
  async overview(input: {
    serviceIds?: readonly string[];
    days: number;
    publicOnly: boolean;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const allServices = await this.listServices();
    const services = input.serviceIds
      ? input.serviceIds
          .map((id) => allServices.find((service) => service.id === id))
          .filter((service): service is ServiceRecord => Boolean(service))
      : allServices;
    const serviceIds = services.map((service) => service.id);
    const monitors = serviceIds.length
      ? await this.db.repository<MonitorRecord>('mnMonitors').findMany({
          filter: (f) =>
            f.or(serviceIds.map((id) => f.string('serviceId').eq(id))),
          sort: (s) => [s.field('sortOrder').asc(), s.field('name').asc()],
        })
      : [];
    const serviceOf = new Map(
      monitors.map((monitor) => [monitor.id, monitor.serviceId]),
    );
    const days = await this.uptimeByDay(
      monitors.map((monitor) => monitor.id),
      input.days,
      (monitorId) => serviceOf.get(monitorId) ?? monitorId,
      now,
    );
    const incidents = await this.incidentsForServices(
      serviceIds,
      new Date(now.getTime() - 14 * DAY_MS),
      input.publicOnly,
    );
    return {
      services: services.map((service) => {
        const own = monitors.filter(
          (monitor) => monitor.serviceId === service.id,
        );
        const series =
          days.get(service.id) ??
          lastDays(input.days, now).map((day) => emptyDay(day));
        return {
          service,
          health: serviceHealth(own.map((monitor) => monitor.status)),
          monitors: own,
          days: series,
          uptime: overallUptime(series),
        };
      }),
      incidents,
    };
  }
}

type IncidentFilterBuilder = FilterBuilder<IncidentRecord>;

export type ServiceInput = Pick<
  ServiceRecord,
  | 'name'
  | 'slug'
  | 'description'
  | 'groupName'
  | 'repoUrl'
  | 'runbook'
  | 'sortOrder'
>;

export type MonitorInput = Pick<
  MonitorRecord,
  | 'serviceId'
  | 'name'
  | 'type'
  | 'region'
  | 'url'
  | 'method'
  | 'headers'
  | 'body'
  | 'expectedStatus'
  | 'keyword'
  | 'jsonPath'
  | 'jsonExpected'
  | 'intervalSec'
  | 'timeoutMs'
  | 'degradedLatencyMs'
  | 'failureThreshold'
  | 'recoveryThreshold'
  | 'enabled'
  | 'autoDiagnose'
  | 'remediationLevel'
  | 'sortOrder'
>;

export type StatusPageInput = Pick<
  StatusPageRecord,
  'slug' | 'title' | 'description' | 'serviceIds' | 'published'
>;

function emptyDay(day: string): UptimeDay {
  return {
    day,
    total: 0,
    up: 0,
    degraded: 0,
    down: 0,
    uptime: null,
    avgLatencyMs: null,
  };
}

/** Uptime over a range of days, weighted by the number of checks; null when nothing was checked. */
export function overallUptime(days: readonly UptimeDay[]): number | null {
  const total = days.reduce((sum, day) => sum + day.total, 0);
  if (!total) return null;
  return days.reduce((sum, day) => sum + day.up + day.degraded, 0) / total;
}

export class IncidentNotFoundError extends Error {
  constructor(readonly incidentId: string) {
    super(`Incident ${incidentId} was not found.`);
  }
}
