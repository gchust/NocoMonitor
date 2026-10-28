import { z } from 'zod';

import { DIAGNOSIS_LANGUAGES } from '../monitoring/language.js';
import { AI_VERDICTS, ALERT_EVENTS } from '../monitoring/types.js';

const Id = z.string().min(1).max(64);
const Time = z.iso.datetime();
const NullableTime = Time.nullable();
const DiagnosisLanguageSchema = z.enum(DIAGNOSIS_LANGUAGES);

export const MonitorStatusSchema = z.enum([
  'pending',
  'up',
  'degraded',
  'down',
  'paused',
]);
export const IncidentStatusSchema = z.enum([
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);
export const IncidentSeveritySchema = z.enum(['minor', 'major', 'critical']);
export const RemediationLevelSchema = z.enum([
  'off',
  'suggest',
  'approve',
  'auto',
]);
export const ServiceHealthSchema = z.enum([
  'operational',
  'degraded',
  'partialOutage',
  'majorOutage',
  'maintenance',
  'unknown',
]);

/** What a header value reads as in answers; sending it back keeps the stored value. */
export const MASKED = '••••••';

export const RemediationActionSchema = z
  .object({
    key: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    method: z.enum(['POST', 'GET', 'PUT']),
    url: z.string(),
    headers: z.record(z.string(), z.string()).nullable(),
    body: z.string().nullable(),
  })
  .meta({ ref: 'NocoMonitorRemediationAction' });

export const ServiceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    groupName: z.string().nullable(),
    repoUrl: z.string().nullable(),
    runbook: z.string().nullable(),
    remediations: z.array(RemediationActionSchema).nullable(),
    sortOrder: z.number(),
    createdAt: Time,
    updatedAt: Time,
  })
  .meta({ ref: 'NocoMonitorService' });

export const MonitorSchema = z
  .object({
    id: z.string(),
    serviceId: z.string(),
    name: z.string(),
    type: z.enum(['http', 'keyword', 'json']),
    region: z.string().nullable(),
    url: z.string(),
    method: z.string(),
    headers: z.record(z.string(), z.string()).nullable(),
    body: z.string().nullable(),
    expectedStatus: z.string(),
    keyword: z.string().nullable(),
    jsonPath: z.string().nullable(),
    jsonExpected: z.string().nullable(),
    intervalSec: z.number(),
    timeoutMs: z.number(),
    degradedLatencyMs: z.number().nullable(),
    failureThreshold: z.number(),
    recoveryThreshold: z.number(),
    enabled: z.boolean(),
    autoDiagnose: z.boolean(),
    remediationLevel: RemediationLevelSchema,
    status: MonitorStatusSchema,
    statusChangedAt: NullableTime,
    lastCheckedAt: NullableTime,
    nextCheckAt: NullableTime,
    lastLatencyMs: z.number().nullable(),
    lastHttpStatus: z.number().nullable(),
    lastError: z.string().nullable(),
    consecutiveFailures: z.number(),
    consecutiveSuccesses: z.number(),
    sortOrder: z.number(),
    createdAt: Time,
    updatedAt: Time,
  })
  .meta({ ref: 'NocoMonitorMonitor' });

export const CheckSchema = z
  .object({
    id: z.string(),
    monitorId: z.string(),
    checkedAt: Time,
    status: z.enum(['up', 'degraded', 'down']),
    latencyMs: z.number().nullable(),
    httpStatus: z.number().nullable(),
    error: z.string().nullable(),
    details: z.record(z.string(), z.unknown()).nullable(),
  })
  .meta({ ref: 'NocoMonitorCheck' });

export const UptimeDaySchema = z
  .object({
    day: z.string(),
    total: z.number(),
    up: z.number(),
    degraded: z.number(),
    down: z.number(),
    uptime: z.number().nullable(),
    avgLatencyMs: z.number().nullable(),
  })
  .meta({ ref: 'NocoMonitorUptimeDay' });

export const IncidentSchema = z
  .object({
    id: z.string(),
    serviceId: z.string(),
    monitorId: z.string().nullable(),
    title: z.string(),
    status: IncidentStatusSchema,
    severity: IncidentSeveritySchema,
    source: z.enum(['auto', 'manual']),
    groupId: z.string().nullable(),
    publicVisible: z.boolean(),
    startedAt: Time,
    resolvedAt: NullableTime,
    aiState: z.enum(['none', 'queued', 'running', 'completed', 'failed']),
    aiRunId: z.string().nullable(),
    aiSummary: z.string().nullable(),
    aiRootCause: z.string().nullable(),
    aiConfidence: z.string().nullable(),
    aiVerdict: z.enum(AI_VERDICTS).nullable(),
    aiSuggestedActions: z.array(z.unknown()).nullable(),
    aiUpdatedAt: NullableTime,
    aiFirstDiagnosedAt: NullableTime,
    createdById: z.string().nullable(),
    createdAt: Time,
    updatedAt: Time,
  })
  .meta({ ref: 'NocoMonitorIncident' });

export const IncidentUpdateSchema = z
  .object({
    id: z.string(),
    incidentId: z.string(),
    kind: z.enum(['status', 'note', 'diagnosis', 'remediation', 'system']),
    status: IncidentStatusSchema.nullable(),
    body: z.string(),
    authorType: z.enum(['system', 'user', 'agent']),
    authorId: z.string().nullable(),
    authorName: z.string().nullable(),
    publicVisible: z.boolean(),
    createdAt: Time,
  })
  .meta({ ref: 'NocoMonitorIncidentUpdate' });

export const StatusPageSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    serviceIds: z.array(z.string()),
    published: z.boolean(),
    createdAt: Time,
    updatedAt: Time,
  })
  .meta({ ref: 'NocoMonitorStatusPage' });

export const ServiceOverviewSchema = z
  .object({
    service: ServiceSchema,
    health: ServiceHealthSchema,
    monitors: z.array(MonitorSchema),
    days: z.array(UptimeDaySchema),
    uptime: z.number().nullable(),
  })
  .meta({ ref: 'NocoMonitorServiceOverview' });

export const OverviewSchema = z
  .object({
    services: z.array(ServiceOverviewSchema),
    incidents: z.array(IncidentSchema),
  })
  .meta({ ref: 'NocoMonitorOverview' });

export const MonitorDetailSchema = z.object({
  monitor: MonitorSchema,
  service: ServiceSchema.nullable(),
  days: z.array(UptimeDaySchema),
  uptime: z.number().nullable(),
  incidents: z.array(IncidentSchema),
});

/** One incident of a group, as the incident page lists it. */
const GroupedIncidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: IncidentStatusSchema,
  monitorName: z.string().nullable(),
});

export const IncidentDetailSchema = z.object({
  incident: IncidentSchema,
  service: ServiceSchema.nullable(),
  monitor: MonitorSchema.nullable(),
  updates: z.array(IncidentUpdateSchema),
  /**
   * The incidents opened together with this one. `lead` is the incident that leads the group, which the agent
   * diagnoses, or null when this incident leads it (or stands alone); `members` are the incidents that joined it.
   */
  group: z.object({
    lead: IncidentSchema.nullable(),
    members: z.array(GroupedIncidentSchema),
  }),
});

export const PublicStatusSchema = z
  .object({
    page: z.object({
      slug: z.string(),
      title: z.string(),
      description: z.string().nullable(),
    }),
    health: ServiceHealthSchema,
    services: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        health: ServiceHealthSchema,
        uptime: z.number().nullable(),
        days: z.array(UptimeDaySchema),
        components: z.array(
          z.object({
            name: z.string(),
            region: z.string().nullable(),
            status: MonitorStatusSchema,
          }),
        ),
      }),
    ),
    /** Probe-opened incidents that recovered within `blipMinutes`, counted rather than listed. */
    blips: z.number().int(),
    blipMinutes: z.number().int(),
    incidents: z.array(
      z.object({
        id: z.string(),
        serviceId: z.string(),
        title: z.string(),
        status: IncidentStatusSchema,
        severity: IncidentSeveritySchema,
        startedAt: Time,
        resolvedAt: NullableTime,
        /** How many monitors' incidents this one stands for: 1, or the size of the group it leads. */
        affected: z.number().int(),
        updates: z.array(
          z.object({
            status: IncidentStatusSchema.nullable(),
            body: z.string(),
            createdAt: Time,
          }),
        ),
      }),
    ),
    generatedAt: Time,
  })
  .meta({ ref: 'NocoMonitorPublicStatus' });

// ----------------------------------------------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------------------------------------------

export const ServiceParams = z.object({ serviceId: Id });
export const MonitorParams = z.object({ monitorId: Id });
export const IncidentParams = z.object({ incidentId: Id });
export const StatusPageParams = z.object({ statusPageId: Id });
export const PublicStatusParams = z.object({
  slug: z.string().min(1).max(128),
});

/**
 * A PATCH body: every field of `schema` optional, and none defaulted. `.partial()` alone keeps each `.default()`, which
 * would quietly reset every field the caller left out.
 */
function patchOf<TShape extends z.ZodRawShape>(schema: z.ZodObject<TShape>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      (
        (field instanceof z.ZodDefault ? field.unwrap() : field) as z.ZodType
      ).optional(),
    ]),
  );
  return z.strictObject(shape) as unknown as z.ZodType<
    Partial<z.output<z.ZodObject<TShape>>>
  >;
}

const Slug = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, digits and dashes.');

export const ServiceInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  slug: Slug,
  description: z.string().max(5000).nullable().default(null),
  groupName: z.string().trim().max(255).nullable().default(null),
  repoUrl: z
    .url({ protocol: /^https?$/ })
    .max(512)
    .nullable()
    .default(null),
  runbook: z.string().max(20000).nullable().default(null),
  remediations: z
    .array(
      z.strictObject({
        key: z
          .string()
          .trim()
          .regex(
            /^[a-z0-9][a-z0-9-]{0,63}$/,
            'Use lowercase letters, digits and dashes.',
          ),
        title: z.string().trim().min(1).max(255),
        description: z.string().max(2000).nullable().default(null),
        method: z.enum(['POST', 'GET', 'PUT']).default('POST'),
        url: z.url({ protocol: /^https?$/ }).max(2048),
        headers: z
          .record(z.string().max(256), z.string().max(4096))
          .nullable()
          .default(null),
        body: z.string().max(65536).nullable().default(null),
      }),
    )
    .max(20)
    .refine(
      (actions) => new Set(actions.map((a) => a.key)).size === actions.length,
      'Each action needs its own key.',
    )
    .nullable()
    .default(null),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});
export const ServicePatchSchema = patchOf(ServiceInputSchema);

export const MonitorInputSchema = z.strictObject({
  serviceId: Id,
  name: z.string().trim().min(1).max(255),
  type: z.enum(['http', 'keyword', 'json']),
  region: z.string().trim().max(64).nullable().default(null),
  url: z.url({ protocol: /^https?$/ }).max(2048),
  method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
  headers: z
    .record(z.string().max(256), z.string().max(4096))
    .nullable()
    .default(null),
  body: z.string().max(65536).nullable().default(null),
  expectedStatus: z
    .string()
    .trim()
    .regex(
      /^\d{3}(-\d{3})?(,\s*\d{3}(-\d{3})?)*$/,
      'Use codes or ranges such as 200-299,301.',
    )
    .default('200-299'),
  keyword: z.string().max(512).nullable().default(null),
  jsonPath: z.string().max(255).nullable().default(null),
  jsonExpected: z.string().max(512).nullable().default(null),
  intervalSec: z.number().int().min(20).max(86400).default(60),
  timeoutMs: z.number().int().min(1000).max(60000).default(10000),
  degradedLatencyMs: z
    .number()
    .int()
    .min(1)
    .max(60000)
    .nullable()
    .default(null),
  failureThreshold: z.number().int().min(1).max(20).default(2),
  recoveryThreshold: z.number().int().min(1).max(20).default(2),
  enabled: z.boolean().default(true),
  autoDiagnose: z.boolean().default(true),
  remediationLevel: RemediationLevelSchema.default('off'),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});
export const MonitorPatchSchema = patchOf(MonitorInputSchema);

export const ChecksQuery = z.object({
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(24),
});

export const IncidentListQuery = z.object({
  state: z.enum(['open', 'resolved', 'all']).default('all'),
  serviceId: Id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const IncidentInputSchema = z.strictObject({
  serviceId: Id,
  monitorId: Id.nullable().default(null),
  title: z.string().trim().min(1).max(512),
  severity: IncidentSeveritySchema.default('major'),
  body: z.string().trim().min(1).max(20000),
  publicVisible: z.boolean().default(true),
});
export const IncidentPatchSchema = z.strictObject({
  title: z.string().trim().min(1).max(512).optional(),
  severity: IncidentSeveritySchema.optional(),
  publicVisible: z.boolean().optional(),
});
export const IncidentUpdateInputSchema = z.strictObject({
  body: z.string().trim().min(1).max(20000),
  status: IncidentStatusSchema.optional(),
  publicVisible: z.boolean().default(false),
});

export const StatusPageInputSchema = z.strictObject({
  slug: Slug,
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullable().default(null),
  serviceIds: z.array(Id).max(200),
  published: z.boolean().default(true),
});
export const StatusPagePatchSchema = patchOf(StatusPageInputSchema);

export const OverviewQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(90),
});

// ----------------------------------------------------------------------------------------------------------------
// AI: settings, diagnosis, remediation, and the commands diagnosis runs call
// ----------------------------------------------------------------------------------------------------------------

export const AiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    agentId: z.string().nullable(),
    actorUserId: z.string().nullable(),
    actorName: z.string().nullable(),
    language: DiagnosisLanguageSchema.nullable(),
  })
  .meta({ ref: 'NocoMonitorAiSettings' });

export const AiSettingsInputSchema = z.strictObject({
  enabled: z.boolean(),
  agentId: z.string().min(1).max(128).nullable(),
  /** Null, or left out, follows the application's default locale. */
  language: DiagnosisLanguageSchema.nullable().default(null),
});

export const BriefingQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});

export const BriefingSchema = z
  .object({
    since: Time,
    agent: z.object({
      configured: z.boolean(),
      enabled: z.boolean(),
      name: z.string().nullable(),
      tool: z.string().nullable(),
      model: z.string().nullable(),
      online: z.boolean().nullable(),
      busy: z.number().int(),
    }),
    stats: z.object({
      incidents: z.number().int(),
      diagnosed: z.number().int(),
      medianTimeToDiagnosisMs: z.number().nullable(),
      fixesRequested: z.number().int(),
      fixesVerified: z.number().int(),
      needsYou: z.number().int(),
    }),
    needsYou: z.array(
      z.object({
        kind: z.enum(['approval', 'diagnosisFailed']),
        incidentId: z.string(),
        incidentTitle: z.string(),
        at: Time,
        actionTitle: z.string().nullable(),
      }),
    ),
    pendingFixes: z.array(
      z.object({ incidentId: z.string(), actionTitle: z.string() }),
    ),
    feed: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(['diagnosis', 'remediation']),
        authorType: z.enum(['system', 'user', 'agent']),
        incidentId: z.string(),
        incidentTitle: z.string(),
        at: Time,
        text: z.string(),
      }),
    ),
  })
  .meta({ ref: 'NocoMonitorAiBriefing' });

export const InvestigationActivitySchema = z
  .object({
    runId: z.string().nullable(),
    status: z.enum(['none', 'queued', 'running', 'completed', 'failed']),
    startedAt: NullableTime,
    finishedAt: NullableTime,
    model: z.string().nullable(),
    steps: z.array(
      z.object({
        seq: z.number().int(),
        at: Time,
        kind: z.enum([
          'context',
          'probe',
          'request',
          'code',
          'diagnose',
          'remediate',
          'reply',
          'command',
        ]),
        targets: z.array(z.string()),
        more: z.number().int(),
      }),
    ),
  })
  .meta({ ref: 'NocoMonitorInvestigationActivity' });

export const RemediationSchema = z
  .object({
    id: z.string(),
    incidentId: z.string(),
    serviceId: z.string(),
    monitorId: z.string().nullable(),
    actionKey: z.string(),
    actionTitle: z.string(),
    reason: z.string(),
    status: z.enum([
      'pending',
      'rejected',
      'running',
      'failed',
      'verifying',
      'verified',
      'unverified',
    ]),
    requestedByType: z.enum(['agent', 'user']),
    requestedByName: z.string().nullable(),
    runId: z.string().nullable(),
    decidedByName: z.string().nullable(),
    decidedAt: NullableTime,
    executedAt: NullableTime,
    httpStatus: z.number().nullable(),
    output: z.string().nullable(),
    verifyAt: NullableTime,
    verifiedAt: NullableTime,
    createdAt: Time,
  })
  .meta({ ref: 'NocoMonitorRemediation' });

export const RemediationOptionsSchema = z.object({
  level: RemediationLevelSchema,
  actions: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      description: z.string().nullable(),
    }),
  ),
  remediations: z.array(RemediationSchema),
});

export const RemediationParams = z.object({ remediationId: Id });
export const RemediationRequestSchema = z.strictObject({
  action: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1).max(4000),
});
export const RemediationRejectSchema = z.strictObject({
  note: z.string().trim().max(2000).optional(),
});

export const DiagnosisStartedSchema = z.object({ runId: z.string() });

export const DiagnosisInputSchema = z.strictObject({
  summary: z.string().trim().min(1).max(4000),
  rootCause: z.string().trim().max(20000).nullable().default(null),
  confidence: z.enum(['low', 'medium', 'high']).nullable().default(null),
  verdict: z.enum(AI_VERDICTS).nullable().default(null),
  suggestedActions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(255),
        description: z.string().max(4000).optional(),
        risk: z.enum(['low', 'medium', 'high']).optional(),
        command: z.string().max(4000).optional(),
      }),
    )
    .max(10)
    .default([]),
});

export const AgentIncidentContextSchema = z
  .record(z.string(), z.unknown())
  .meta({ ref: 'NocoMonitorAgentIncidentContext' });

export const ProbeResultSchema = z.object({
  status: z.enum(['up', 'degraded', 'down']),
  httpStatus: z.number().nullable(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
});

// ---------------------------------------------------------------------------------------------------------------------
// Drill and alert notifications
// ---------------------------------------------------------------------------------------------------------------------

export const DrillSchema = z
  .object({
    state: z.enum(['idle', 'running', 'recovered']),
    serviceId: Id.nullable(),
    monitorId: Id.nullable(),
    incidentId: Id.nullable(),
    startedAt: NullableTime,
    detectedAt: NullableTime,
    aiState: z
      .enum(['none', 'queued', 'running', 'completed', 'failed'])
      .nullable(),
    diagnosedAt: NullableTime,
    fix: z
      .object({
        status: z.enum([
          'pending',
          'rejected',
          'running',
          'failed',
          'verifying',
          'verified',
          'unverified',
        ]),
        requestedAt: Time,
        actionTitle: z.string(),
      })
      .nullable(),
    recoveredAt: NullableTime,
    targetUnreachable: z.boolean(),
    targetUrl: z.string().nullable(),
    completedOnce: z.boolean(),
  })
  .meta({ ref: 'NocoMonitorDrill' });

export const DrillTargetParams = z.object({ token: z.string().min(1).max(64) });

export const AlertEventSchema = z.enum(ALERT_EVENTS);

export const AlertSettingsInputSchema = z.strictObject({
  recipients: z.array(Id).max(100),
  channels: z.array(z.string().min(1).max(64)).max(20),
  events: z.strictObject(
    Object.fromEntries(ALERT_EVENTS.map((event) => [event, z.boolean()])) as {
      [K in (typeof ALERT_EVENTS)[number]]: z.ZodBoolean;
    },
  ),
});

const AlertRecipientSchema = z.object({
  id: Id,
  name: z.string(),
  email: z.string().nullable(),
});

export const AlertSettingsSchema = z
  .object({
    recipients: z.array(AlertRecipientSchema),
    channels: z.array(z.string()),
    events: AlertSettingsInputSchema.shape.events,
    available: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        kind: z.enum(['inApp', 'email', 'webhook', 'unsupported']),
      }),
    ),
  })
  .meta({ ref: 'NocoMonitorAlertSettings' });

export const AlertRecipientQuery = z.object({
  q: z.string().max(100).default(''),
});

export const AlertRecipientsSchema = z.array(AlertRecipientSchema);

const AlertDeliveryStatusSchema = z.enum([
  'pending',
  'delivered',
  'partial',
  'failed',
  'unknown',
]);

export const AlertDeliverySchema = z
  .object({
    key: z.string(),
    event: z.union([AlertEventSchema, z.literal('test')]),
    incidentId: Id.nullable(),
    title: z.string(),
    at: Time,
    status: AlertDeliveryStatusSchema,
    channels: z.array(
      z.object({ name: z.string(), status: AlertDeliveryStatusSchema }),
    ),
  })
  .meta({ ref: 'NocoMonitorAlertDelivery' });

// ---------------------------------------------------------------------------------------------------------------------
// Setting up with an agent
// ---------------------------------------------------------------------------------------------------------------------

const SetupKindSchema = z.enum(['monitors', 'statusPage']);
const SetupKey = z.string().trim().min(1).max(64);

const SetupQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  options: z.array(z.string()),
});

const ProposedMonitorInputSchema = MonitorInputSchema.pick({
  name: true,
  type: true,
  url: true,
  method: true,
  expectedStatus: true,
  keyword: true,
  jsonPath: true,
  jsonExpected: true,
  intervalSec: true,
  timeoutMs: true,
  degradedLatencyMs: true,
  autoDiagnose: true,
})
  .extend({
    service: SetupKey,
    note: z.string().trim().max(1000).nullable().default(null),
  })
  .refine((monitor) => monitor.type !== 'keyword' || monitor.keyword, {
    message: 'A keyword monitor needs its keyword.',
    path: ['keyword'],
  })
  .refine((monitor) => monitor.type !== 'json' || monitor.jsonPath, {
    message: 'A JSON monitor needs its jsonPath.',
    path: ['jsonPath'],
  });

/** What the agent proposes; every monitor and the status page name their services by the proposal's own keys. */
export const SetupProposalInputSchema = z
  .strictObject({
    services: z
      .array(
        z.strictObject({
          key: SetupKey,
          existingId: Id.nullable().default(null),
          name: z.string().trim().min(1).max(255),
          description: z.string().trim().max(5000).nullable().default(null),
          repoUrl: z
            .url({ protocol: /^https?$/ })
            .max(512)
            .nullable()
            .default(null),
        }),
      )
      .max(50)
      .default([]),
    monitors: z.array(ProposedMonitorInputSchema).max(50).default([]),
    statusPage: z
      .strictObject({
        title: z.string().trim().min(1).max(255),
        slug: Slug,
        description: z.string().trim().max(5000).nullable().default(null),
        services: z.array(SetupKey).min(1).max(200),
      })
      .nullable()
      .default(null),
  })
  .superRefine((proposal, context) => {
    const keys = new Set(proposal.services.map((service) => service.key));
    if (keys.size !== proposal.services.length)
      context.addIssue({
        code: 'custom',
        message: 'Each service needs its own key.',
        path: ['services'],
      });
    proposal.monitors.forEach((monitor, index) => {
      if (!keys.has(monitor.service))
        context.addIssue({
          code: 'custom',
          message: `No service has the key "${monitor.service}".`,
          path: ['monitors', index, 'service'],
        });
    });
    proposal.statusPage?.services.forEach((key, index) => {
      if (!keys.has(key))
        context.addIssue({
          code: 'custom',
          message: `No service has the key "${key}".`,
          path: ['statusPage', 'services', index],
        });
    });
    if (!proposal.monitors.length && !proposal.statusPage)
      context.addIssue({
        code: 'custom',
        message: 'Propose at least one monitor or a status page.',
        path: ['monitors'],
      });
  });

/** The agent's answer to the person's latest message: always a message, then questions, a proposal, or both. */
export const SetupReplyInputSchema = z.strictObject({
  message: z.string().trim().min(1).max(4000),
  questions: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(500),
        options: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
      }),
    )
    .max(5)
    .default([]),
  proposal: SetupProposalInputSchema.nullable().default(null),
});

/** A monitor the agent wants to check from where NocoMonitor probes, before proposing it. Nothing is saved. */
export const SetupTryInputSchema = MonitorInputSchema.pick({
  type: true,
  url: true,
  method: true,
  expectedStatus: true,
  keyword: true,
  jsonPath: true,
  jsonExpected: true,
  timeoutMs: true,
  degradedLatencyMs: true,
});

export const SetupParams = z.object({ setupId: Id });

export const SetupInputSchema = z.strictObject({
  kind: SetupKindSchema,
  text: z.string().trim().min(1).max(4000),
  language: DiagnosisLanguageSchema,
});

export const SetupMessageInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
});

export const SetupApplyInputSchema = z.strictObject({
  /** Indexes into the proposal's monitors: the ones to create. */
  monitors: z.array(z.number().int().min(0)).max(50),
  statusPage: z.boolean(),
});

const ProposalSchema = z.object({
  services: z.array(
    z.object({
      key: z.string(),
      existingId: z.string().nullable(),
      name: z.string(),
      description: z.string().nullable(),
      repoUrl: z.string().nullable(),
    }),
  ),
  monitors: z.array(
    z.object({
      service: z.string(),
      name: z.string(),
      type: z.enum(['http', 'keyword', 'json']),
      url: z.string(),
      method: z.string(),
      expectedStatus: z.string(),
      keyword: z.string().nullable(),
      jsonPath: z.string().nullable(),
      jsonExpected: z.string().nullable(),
      intervalSec: z.number(),
      timeoutMs: z.number(),
      degradedLatencyMs: z.number().nullable(),
      autoDiagnose: z.boolean(),
      note: z.string().nullable(),
    }),
  ),
  statusPage: z
    .object({
      title: z.string(),
      slug: z.string(),
      description: z.string().nullable(),
      services: z.array(z.string()),
    })
    .nullable(),
});

export const SetupSchema = z
  .object({
    id: z.string(),
    kind: SetupKindSchema,
    state: z.enum(['queued', 'running', 'replied', 'failed', 'applied']),
    runId: z.string().nullable(),
    language: DiagnosisLanguageSchema,
    turns: z.array(
      z.object({
        id: z.string(),
        role: z.enum(['user', 'agent']),
        at: Time,
        text: z.string(),
        questions: z.array(SetupQuestionSchema),
        proposal: ProposalSchema.nullable(),
        runId: z.string().nullable(),
      }),
    ),
    result: z
      .object({
        serviceIds: z.array(z.string()),
        monitorIds: z.array(z.string()),
        statusPageId: z.string().nullable(),
        chosen: z.object({
          monitors: z.array(z.number().int()),
          statusPage: z.boolean(),
        }),
      })
      .nullable(),
    createdById: z.string(),
    createdByName: z.string().nullable(),
    createdAt: Time,
    updatedAt: Time,
    appliedAt: NullableTime,
  })
  .meta({ ref: 'NocoMonitorSetup' });

export const SetupActivitySchema = InvestigationActivitySchema.extend({
  status: z.enum(['queued', 'running', 'replied', 'failed', 'applied']),
}).meta({ ref: 'NocoMonitorSetupActivity' });

export const AgentSetupContextSchema = z
  .record(z.string(), z.unknown())
  .meta({ ref: 'NocoMonitorAgentSetupContext' });
