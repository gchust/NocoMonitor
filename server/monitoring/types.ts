/** Records of NocoMonitor's own tables, as the Repository returns them. */

export type MonitorType = 'http' | 'keyword' | 'json';
export type CheckStatus = 'up' | 'degraded' | 'down';
export type MonitorStatus = CheckStatus | 'pending' | 'paused';
export type IncidentStatus =
  'investigating' | 'identified' | 'monitoring' | 'resolved';
export type IncidentSeverity = 'minor' | 'major' | 'critical';
export type RemediationLevel = 'off' | 'suggest' | 'approve' | 'auto';
export type AiState = 'none' | 'queued' | 'running' | 'completed' | 'failed';

export interface ServiceRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  groupName: string | null;
  repoUrl: string | null;
  runbook: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonitorRecord {
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
  statusChangedAt: Date | null;
  lastCheckedAt: Date | null;
  nextCheckAt: Date | null;
  lastLatencyMs: number | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CheckRecord {
  id: string;
  monitorId: string;
  checkedAt: Date;
  status: CheckStatus;
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
  details: Record<string, unknown> | null;
}

export interface DailyStatRecord {
  id: string;
  monitorId: string;
  day: string;
  total: number;
  upCount: number;
  degradedCount: number;
  downCount: number;
  latencySum: number;
  latencyCount: number;
}

export interface IncidentRecord {
  id: string;
  serviceId: string;
  monitorId: string | null;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  source: 'auto' | 'manual';
  publicVisible: boolean;
  startedAt: Date;
  resolvedAt: Date | null;
  aiState: AiState;
  aiRunId: string | null;
  aiSummary: string | null;
  aiRootCause: string | null;
  aiConfidence: string | null;
  aiSuggestedActions: unknown[] | null;
  aiUpdatedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IncidentUpdateKind =
  'status' | 'note' | 'diagnosis' | 'remediation' | 'system';

export interface IncidentUpdateRecord {
  id: string;
  incidentId: string;
  kind: IncidentUpdateKind;
  status: IncidentStatus | null;
  body: string;
  authorType: 'system' | 'user' | 'agent';
  authorId: string | null;
  authorName: string | null;
  publicVisible: boolean;
  createdAt: Date;
}

export interface StatusPageRecord {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  serviceIds: string[];
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** What one probe found. */
export interface ProbeResult {
  status: CheckStatus;
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
  details: Record<string, unknown>;
}

/** Who did something, for incident timelines. */
export interface Actor {
  type: 'system' | 'user' | 'agent';
  id: string | null;
  name: string | null;
}
