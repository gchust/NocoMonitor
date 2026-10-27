import { z } from 'zod';

const Id = z.string().min(1).max(64);
const Time = z.iso.datetime();
const NullableTime = Time.nullable();

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

export const ServiceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    groupName: z.string().nullable(),
    repoUrl: z.string().nullable(),
    runbook: z.string().nullable(),
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
    publicVisible: z.boolean(),
    startedAt: Time,
    resolvedAt: NullableTime,
    aiState: z.enum(['none', 'queued', 'running', 'completed', 'failed']),
    aiRunId: z.string().nullable(),
    aiSummary: z.string().nullable(),
    aiRootCause: z.string().nullable(),
    aiConfidence: z.string().nullable(),
    aiSuggestedActions: z.array(z.unknown()).nullable(),
    aiUpdatedAt: NullableTime,
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

export const IncidentDetailSchema = z.object({
  incident: IncidentSchema,
  service: ServiceSchema.nullable(),
  monitor: MonitorSchema.nullable(),
  updates: z.array(IncidentUpdateSchema),
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
    incidents: z.array(
      z.object({
        id: z.string(),
        serviceId: z.string(),
        title: z.string(),
        status: IncidentStatusSchema,
        severity: IncidentSeveritySchema,
        startedAt: Time,
        resolvedAt: NullableTime,
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
