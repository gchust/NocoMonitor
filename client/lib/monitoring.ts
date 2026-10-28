/** The shapes NocoMonitor's endpoints answer (server/routes/schemas.ts), and small formatting helpers. */

export type MonitorType = 'http' | 'keyword' | 'json';
export type MonitorStatus = 'pending' | 'up' | 'degraded' | 'down' | 'paused';
export type IncidentStatus =
  'investigating' | 'identified' | 'monitoring' | 'resolved';
export type IncidentSeverity = 'minor' | 'major' | 'critical';
export type RemediationLevel = 'off' | 'suggest' | 'approve' | 'auto';
export type AiState = 'none' | 'queued' | 'running' | 'completed' | 'failed';
export type ServiceHealth =
  | 'operational'
  | 'degraded'
  | 'partialOutage'
  | 'majorOutage'
  | 'maintenance'
  | 'unknown';

export const MONITOR_TYPES: readonly MonitorType[] = [
  'http',
  'keyword',
  'json',
];
export const INCIDENT_STATUSES: readonly IncidentStatus[] = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
];
export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = [
  'minor',
  'major',
  'critical',
];
export const REMEDIATION_LEVELS: readonly RemediationLevel[] = [
  'off',
  'suggest',
  'approve',
  'auto',
];

export interface Service {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  groupName: string | null;
  repoUrl: string | null;
  runbook: string | null;
  remediations: RemediationAction[] | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Monitor {
  id: string;
  serviceId: string;
  name: string;
  type: MonitorType;
  region: string | null;
  url: string;
  method: string;
  headers: Record<string, string> | null;
  body: string | null;
  expectedStatus: string;
  keyword: string | null;
  jsonPath: string | null;
  jsonExpected: string | null;
  intervalSec: number;
  timeoutMs: number;
  degradedLatencyMs: number | null;
  failureThreshold: number;
  recoveryThreshold: number;
  enabled: boolean;
  autoDiagnose: boolean;
  remediationLevel: RemediationLevel;
  status: MonitorStatus;
  statusChangedAt: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastLatencyMs: number | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  sortOrder: number;
}

export interface Check {
  id: string;
  monitorId: string;
  checkedAt: string;
  status: 'up' | 'degraded' | 'down';
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
}

export interface UptimeDay {
  day: string;
  total: number;
  up: number;
  degraded: number;
  down: number;
  uptime: number | null;
  avgLatencyMs: number | null;
}

export interface Incident {
  id: string;
  serviceId: string;
  monitorId: string | null;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  source: 'auto' | 'manual';
  /** The incident this one failed together with, which leads the group; null when it leads or stands alone. */
  groupId: string | null;
  publicVisible: boolean;
  startedAt: string;
  resolvedAt: string | null;
  aiState: AiState;
  aiRunId: string | null;
  aiSummary: string | null;
  aiRootCause: string | null;
  aiConfidence: string | null;
  /** The agent's judgement: a real outage, or a false alarm the monitor rather than the service should fix. */
  aiVerdict: 'outage' | 'falseAlarm' | null;
  aiSuggestedActions: unknown[] | null;
  aiUpdatedAt: string | null;
  /** When the agent first recorded a diagnosis, for the time it took to find the root cause. */
  aiFirstDiagnosedAt: string | null;
}

export interface IncidentUpdate {
  id: string;
  incidentId: string;
  kind: 'status' | 'note' | 'diagnosis' | 'remediation' | 'system';
  status: IncidentStatus | null;
  body: string;
  authorType: 'system' | 'user' | 'agent';
  authorName: string | null;
  publicVisible: boolean;
  createdAt: string;
}

export interface StatusPage {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  serviceIds: string[];
  published: boolean;
}

export interface ServiceOverview {
  service: Service;
  health: ServiceHealth;
  monitors: Monitor[];
  days: UptimeDay[];
  uptime: number | null;
}

export interface Overview {
  services: ServiceOverview[];
  incidents: Incident[];
}

export interface List<T> {
  data: T[];
  meta: { total: number; page?: number; pageSize?: number };
}

/** `99.95%`; a dash when nothing was measured. */
export function formatUptime(value: number | null, locale: string): string {
  if (value === null) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: value === 1 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Math.floor(value * 10000) / 10000);
}

export function formatLatency(value: number | null): string {
  return value === null ? '—' : `${value} ms`;
}

export function formatDateTime(value: string | null, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** "3 min ago", "in 20 s": relative to now, in the reader's language. */
export function formatRelative(
  value: string | null,
  locale: string,
  now = Date.now(),
): string {
  if (!value) return '—';
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, {
    numeric: 'auto',
    style: 'short',
  });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, 'second');
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86400), 'day');
}

/** How long something lasted, such as `2 h 5 min`. */
/** A unit amount in the reader's language, such as "42 min" or "42分钟". */
function unit(value: number, name: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: name,
    unitDisplay: 'short',
  }).format(value);
}

export function formatDuration(
  from: string,
  to: string | null,
  locale: string,
  now = Date.now(),
): string {
  const ms = Math.max(
    0,
    (to ? new Date(to).getTime() : now) - new Date(from).getTime(),
  );
  const minutes = Math.round(ms / 60000);
  if (minutes < 1)
    return unit(Math.max(1, Math.round(ms / 1000)), 'second', locale);
  if (minutes < 60) return unit(minutes, 'minute', locale);
  const hours = Math.floor(minutes / 60);
  if (hours < 48)
    return `${unit(hours, 'hour', locale)} ${unit(minutes % 60, 'minute', locale)}`;
  return `${unit(Math.floor(hours / 24), 'day', locale)} ${unit(hours % 24, 'hour', locale)}`;
}

export type DiagnosisLanguage = 'en-US' | 'zh-CN';

export interface AiSettings {
  enabled: boolean;
  agentId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  /** Null follows the application's default locale. */
  language: DiagnosisLanguage | null;
}

/** What the AI did lately and what waits on people (`GET /api/monitoringAi/briefing`). */
export interface AiBriefing {
  since: string;
  agent: {
    configured: boolean;
    enabled: boolean;
    name: string | null;
    tool: string | null;
    model: string | null;
    online: boolean | null;
    busy: number;
  };
  stats: {
    incidents: number;
    diagnosed: number;
    medianTimeToDiagnosisMs: number | null;
    fixesRequested: number;
    fixesVerified: number;
    needsYou: number;
  };
  needsYou: {
    kind: 'approval' | 'diagnosisFailed';
    incidentId: string;
    incidentTitle: string;
    at: string;
    actionTitle: string | null;
  }[];
  /** Every fix waiting for approval on an open incident, uncapped. */
  pendingFixes: { incidentId: string; actionTitle: string }[];
  feed: {
    id: string;
    kind: 'diagnosis' | 'remediation';
    authorType: 'system' | 'user' | 'agent';
    incidentId: string;
    incidentTitle: string;
    at: string;
    text: string;
  }[];
}

export type InvestigationStepKind =
  | 'context'
  | 'probe'
  | 'request'
  | 'code'
  | 'diagnose'
  | 'remediate'
  | 'reply'
  | 'command';

/** The classified steps of an incident's latest diagnosis run (`GET /api/incidents/:id/aiActivity`). */
export interface InvestigationActivity {
  runId: string | null;
  status: AiState;
  startedAt: string | null;
  finishedAt: string | null;
  model: string | null;
  steps: InvestigationStep[];
}

/** One step of an investigation, with what it looked at: an address's host and path, or a file. */
export interface InvestigationStep {
  seq: number;
  at: string;
  kind: InvestigationStepKind;
  targets: string[];
  /** How many more it looked at than `targets` lists. */
  more: number;
}

/** An agent from the Agents plugin's roster (`GET /api/agents/available`). */
export interface AvailableAgent {
  id: string;
  name: string;
  goodAt: string;
  tool: string | null;
  model: string | null;
  online: boolean;
  personalOnly: boolean;
  busy: number;
}

export interface RemediationAction {
  key: string;
  title: string;
  description: string | null;
  method: 'POST' | 'GET' | 'PUT';
  url: string;
  headers: Record<string, string> | null;
  body: string | null;
}

export type RemediationStatus =
  | 'pending'
  | 'rejected'
  | 'running'
  | 'failed'
  | 'verifying'
  | 'verified'
  | 'unverified';

export interface Remediation {
  id: string;
  incidentId: string;
  actionKey: string;
  actionTitle: string;
  reason: string;
  status: RemediationStatus;
  requestedByType: 'agent' | 'user';
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  httpStatus: number | null;
  output: string | null;
  verifyAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface RemediationOptions {
  level: RemediationLevel;
  actions: Pick<RemediationAction, 'key' | 'title' | 'description'>[];
  remediations: Remediation[];
}

/** The drill and how far its automatic response got. */
export interface DrillStatus {
  state: 'idle' | 'running' | 'recovered';
  serviceId: string | null;
  monitorId: string | null;
  incidentId: string | null;
  startedAt: string | null;
  detectedAt: string | null;
  aiState: AiState | null;
  diagnosedAt: string | null;
  fix: {
    status: RemediationStatus;
    requestedAt: string;
    actionTitle: string;
  } | null;
  recoveredAt: string | null;
  targetUnreachable: boolean;
  targetUrl: string | null;
  completedOnce: boolean;
}

export const ALERT_EVENTS = [
  'incidentOpened',
  'fixAwaitingApproval',
  'diagnosisFailed',
  'fixNotRecovered',
  'incidentResolved',
] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

export interface AlertRecipient {
  id: string;
  name: string;
  email: string | null;
}

export interface AlertChannel {
  name: string;
  type: string;
  kind: 'inApp' | 'email' | 'webhook' | 'unsupported';
}

export interface AlertSettingsView {
  recipients: AlertRecipient[];
  channels: string[];
  events: Record<AlertEvent, boolean>;
  available: AlertChannel[];
}

export type AlertDeliveryStatus =
  'pending' | 'delivered' | 'partial' | 'failed' | 'unknown';

export interface AlertDelivery {
  key: string;
  event: AlertEvent | 'test';
  incidentId: string | null;
  title: string;
  at: string;
  status: AlertDeliveryStatus;
  channels: { name: string; status: AlertDeliveryStatus }[];
}

/** The shortest a failed stretch is drawn, so a single failed check stays visible on a week's axis. */
const MIN_RUN_MS = 60_000;

/**
 * The stretches in which checks failed, as [from, to] times: from the first failed check to the next check that
 * answered, or to the last failed one while it is still failing. Checks come oldest first.
 */
export function downRuns(checks: readonly Check[]): [number, number][] {
  const runs: [number, number][] = [];
  let start: number | null = null;
  let last = 0;
  for (const check of checks) {
    const at = new Date(check.checkedAt).getTime();
    if (check.status === 'down') {
      start ??= at;
      last = at;
    } else if (start !== null) {
      runs.push([start, at]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, last]);
  return runs.map(([from, to]) => [from, Math.max(to, from + MIN_RUN_MS)]);
}

/** An incident with the incidents that joined its group, as lists show them: one event, one entry. */
export interface IncidentGroup {
  incident: Incident;
  members: Incident[];
}

/**
 * Folds the incidents that joined a group into the entry of the incident leading it, keeping the list's order. An
 * incident whose lead is not in the list keeps an entry of its own.
 */
export function groupIncidents(
  incidents: readonly Incident[],
): IncidentGroup[] {
  const ids = new Set(incidents.map((incident) => incident.id));
  const members = new Map<string, Incident[]>();
  for (const incident of incidents)
    if (incident.groupId && ids.has(incident.groupId))
      members.set(incident.groupId, [
        ...(members.get(incident.groupId) ?? []),
        incident,
      ]);
  return incidents
    .filter((incident) => !incident.groupId || !ids.has(incident.groupId))
    .map((incident) => ({
      incident,
      members: members.get(incident.id) ?? [],
    }));
}

/** What a person sets up by talking to an agent. */
export type SetupKind = 'monitors' | 'statusPage';
export type SetupState =
  'queued' | 'running' | 'replied' | 'failed' | 'applied';

export interface SetupQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface ProposedService {
  key: string;
  existingId: string | null;
  name: string;
  description: string | null;
  repoUrl: string | null;
}

export interface ProposedMonitor {
  service: string;
  name: string;
  type: MonitorType;
  url: string;
  method: string;
  expectedStatus: string;
  keyword: string | null;
  jsonPath: string | null;
  jsonExpected: string | null;
  intervalSec: number;
  timeoutMs: number;
  degradedLatencyMs: number | null;
  autoDiagnose: boolean;
  note: string | null;
}

export interface SetupProposal {
  services: ProposedService[];
  monitors: ProposedMonitor[];
  statusPage: {
    title: string;
    slug: string;
    description: string | null;
    services: string[];
  } | null;
}

export interface SetupTurn {
  id: string;
  role: 'user' | 'agent';
  at: string;
  text: string;
  questions: SetupQuestion[];
  proposal: SetupProposal | null;
  runId: string | null;
}

/** A conversation with the agent about what to monitor (`GET /api/monitoringSetups/:id`). */
export interface Setup {
  id: string;
  kind: SetupKind;
  state: SetupState;
  runId: string | null;
  turns: SetupTurn[];
  result: {
    serviceIds: string[];
    monitorIds: string[];
    statusPageId: string | null;
    chosen: { monitors: number[]; statusPage: boolean };
  } | null;
  createdByName: string | null;
  createdAt: string;
  appliedAt: string | null;
}

/** The steps of the run answering a setup's latest message (`GET /api/monitoringSetups/:id/activity`). */
export interface SetupActivity extends Omit<InvestigationActivity, 'status'> {
  status: SetupState;
}
