/** Records of NocoMonitor's own tables, as the Repository returns them. */

import type { DiagnosisLanguage } from './language.js';

export type MonitorType = 'http' | 'keyword' | 'json';
export type CheckStatus = 'up' | 'degraded' | 'down';
export type MonitorStatus = CheckStatus | 'pending' | 'paused';
export type IncidentStatus =
  'investigating' | 'identified' | 'monitoring' | 'resolved';
export type IncidentSeverity = 'minor' | 'major' | 'critical';
export type RemediationLevel = 'off' | 'suggest' | 'approve' | 'auto';
export type AiState = 'none' | 'queued' | 'running' | 'completed' | 'failed';
export const AI_VERDICTS = ['outage', 'falseAlarm'] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];

export interface ServiceRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  groupName: string | null;
  repoUrl: string | null;
  runbook: string | null;
  /** The fixes this service allows, which agents and people pick by key. */
  remediations: RemediationAction[] | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A fix a service allows: one fixed HTTP call, such as a deploy hook or a restart endpoint. Whoever asks for it names
 * only its key and a reason; the URL, method, headers and body are the operator's.
 */
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

export interface RemediationRecord {
  id: string;
  incidentId: string;
  serviceId: string;
  monitorId: string | null;
  actionKey: string;
  actionTitle: string;
  reason: string;
  status: RemediationStatus;
  requestedByType: 'agent' | 'user';
  requestedByName: string | null;
  runId: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  executedAt: Date | null;
  httpStatus: number | null;
  output: string | null;
  verifyAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Which agent diagnoses incidents, and as whom its runs act when no person started them. */
// A type rather than an interface, so it is a plain JSON value the settings row can store.
export type AiSettings = {
  enabled: boolean;
  agentId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  /** What diagnoses and opened incidents are written in; null follows the application's default locale. */
  language: DiagnosisLanguage | null;
};

/** The events alert notifications can be sent for. */
export const ALERT_EVENTS = [
  'incidentOpened',
  'fixAwaitingApproval',
  'diagnosisFailed',
  'fixNotRecovered',
  'incidentResolved',
] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

/** Who is told what, through which configured notification channels. */
export type AlertSettings = {
  /** Application user ids, chosen one by one: nobody is notified by role or by default. */
  recipients: string[];
  /** Names of channels in `notification.channels`. */
  channels: string[];
  events: Record<AlertEvent, boolean>;
};

/** The drill: a test service whose health check NocoMonitor serves itself and makes fail. */
export type DrillSettings = {
  /** Present while a drill exists; guards the drill target's public URLs. */
  token: string | null;
  serviceId: string | null;
  monitorId: string | null;
  healthy: boolean;
  startedAt: string | null;
  /** Whether a drill ever recovered: the third step of getting started. */
  completedOnce: boolean;
};

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
  /** The incident this one failed together with, which leads the group; null when it leads or stands alone. */
  groupId: string | null;
  publicVisible: boolean;
  startedAt: Date;
  resolvedAt: Date | null;
  aiState: AiState;
  aiRunId: string | null;
  aiSummary: string | null;
  aiRootCause: string | null;
  aiConfidence: string | null;
  /** The agent's judgement: a real outage, or a false alarm the monitor rather than the service should fix. */
  aiVerdict: AiVerdict | null;
  aiSuggestedActions: unknown[] | null;
  aiUpdatedAt: Date | null;
  /** When the agent first recorded a diagnosis: `aiUpdatedAt` moves with every later one. */
  aiFirstDiagnosedAt: Date | null;
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

/** What a person set up by talking to an agent: monitors (with their services), or a status page. */
export type SetupKind = 'monitors' | 'statusPage';
export type SetupState =
  'queued' | 'running' | 'replied' | 'failed' | 'applied';

/** Something the agent needs to know, with the answers it expects when it can tell them. */
export interface SetupQuestion {
  id: string;
  text: string;
  options: string[];
}

/** A service a proposal uses: one that exists (`existingId`), or one applying creates. Monitors name it by `key`. */
export interface ProposedService {
  key: string;
  existingId: string | null;
  name: string;
  description: string | null;
  repoUrl: string | null;
}

export type ProposedMonitor = Pick<
  MonitorRecord,
  | 'name'
  | 'type'
  | 'url'
  | 'method'
  | 'expectedStatus'
  | 'keyword'
  | 'jsonPath'
  | 'jsonExpected'
  | 'intervalSec'
  | 'timeoutMs'
  | 'degradedLatencyMs'
  | 'autoDiagnose'
> & {
  /** The `key` of its service in the proposal. */
  service: string;
  /** Why the agent chose this check: what it saw when it requested the address. */
  note: string | null;
};

export interface ProposedStatusPage {
  title: string;
  slug: string;
  description: string | null;
  /** The `key`s of the services it shows. */
  services: string[];
}

export interface SetupProposal {
  services: ProposedService[];
  monitors: ProposedMonitor[];
  statusPage: ProposedStatusPage | null;
}

export interface SetupTurn {
  id: string;
  role: 'user' | 'agent';
  at: string;
  text: string;
  questions: SetupQuestion[];
  proposal: SetupProposal | null;
  /** The run that wrote an agent turn, or that a person's turn woke. */
  runId: string | null;
}

export interface SetupResult {
  serviceIds: string[];
  monitorIds: string[];
  statusPageId: string | null;
  /** What the person chose of the proposal: its monitors by index, and whether its status page. */
  chosen: { monitors: number[]; statusPage: boolean };
}

export interface SetupRecord {
  id: string;
  kind: SetupKind;
  state: SetupState;
  runId: string | null;
  language: DiagnosisLanguage;
  turns: SetupTurn[];
  result: SetupResult | null;
  createdById: string;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  appliedAt: Date | null;
}
