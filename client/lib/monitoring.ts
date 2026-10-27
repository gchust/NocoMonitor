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
  publicVisible: boolean;
  startedAt: string;
  resolvedAt: string | null;
  aiState: AiState;
  aiRunId: string | null;
  aiSummary: string | null;
  aiRootCause: string | null;
  aiConfidence: string | null;
  aiSuggestedActions: unknown[] | null;
  aiUpdatedAt: string | null;
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
export function formatDuration(
  from: string,
  to: string | null,
  now = Date.now(),
): string {
  const ms = Math.max(
    0,
    (to ? new Date(to).getTime() : now) - new Date(from).getTime(),
  );
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
