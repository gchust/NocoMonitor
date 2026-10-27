import { authenticationToken, type AuthEnv } from '@nocobase/app-plugin-authentication';
import { authorizationToken, type AuthorizationEnv } from '@nocobase/app-plugin-authorization';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponse,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  listResponse,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type MiddlewareHandler } from 'hono';

import { IncidentNotFoundError } from '../monitoring/service.js';
import type { Actor } from '../monitoring/types.js';
import {
  MONITORING_RESOURCE,
  monitoringServiceToken,
  type MonitoringAction,
} from '../providers/monitoring.js';
import {
  CheckSchema,
  ChecksQuery,
  IncidentDetailSchema,
  IncidentInputSchema,
  IncidentListQuery,
  IncidentParams,
  IncidentPatchSchema,
  IncidentSchema,
  IncidentUpdateInputSchema,
  IncidentUpdateSchema,
  MonitorDetailSchema,
  MonitorInputSchema,
  MonitorParams,
  MonitorPatchSchema,
  MonitorSchema,
  OverviewQuery,
  OverviewSchema,
  ServiceInputSchema,
  ServiceParams,
  ServicePatchSchema,
  ServiceSchema,
  StatusPageInputSchema,
  StatusPageParams,
  StatusPagePatchSchema,
  StatusPageSchema,
} from './schemas.js';

const TAGS = ['NocoMonitor'];
const DOMAIN = 'nocomonitor';

type Env = AuthEnv & AuthorizationEnv;

function notFound(reason: string, message: string): ApiError {
  return new ApiError({ status: 'NOT_FOUND', reason, domain: DOMAIN, message });
}

/** Checks a monitoring action before the route reads its input, so a caller without it learns nothing about it. */
function allow(action: MonitoringAction): MiddlewareHandler<Env> {
  return async (context, next) => {
    await context.get('authz').require({ resource: MONITORING_RESOURCE, action });
    await next();
  };
}

function actorOf(context: { get(key: 'auth'): AuthEnv['Variables']['auth'] }): Actor {
  const user = context.get('auth')?.user;
  return { type: 'user', id: user?.id ?? null, name: user?.name || user?.email || null };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Error && /unique|UNIQUE|duplicate/i.test(`${error.message} ${(error as { code?: string }).code ?? ''}`);

export const monitoringRoutes: AppApiRouteContribution<Application> = defineApiRoutes((app) => {
  const router = new Hono();
  const routes = new Hono<Env>();
  const authentication = app.container.resolve(authenticationToken);
  const authorization = app.container.resolve(authorizationToken);
  const monitoring = () => app.container.resolve(monitoringServiceToken);

  routes.onError((error, context) =>
    apiErrorHandler(
      error instanceof IncidentNotFoundError ? notFound('INCIDENT_NOT_FOUND', error.message) : error,
      context,
    ),
  );
  // Scoped to the paths this module owns: `routes` is mounted at the API root, where `*` would reach every route.
  for (const path of ['/statusOverview', '/services', '/monitors', '/incidents', '/statusPages']) {
    routes.use(path, authentication.required(), authorization.middleware());
    routes.use(`${path}/*`, authentication.required(), authorization.middleware());
  }

  // --------------------------------------------------------------------------------------------------------------
  // Overview
  // --------------------------------------------------------------------------------------------------------------

  routes.get(
    '/statusOverview',
    describeRoute({
      tags: TAGS,
      summary: 'Read every service with its monitors, daily uptime and open incidents',
      operationId: 'nocomonitorReadStatusOverview',
      responses: { '200': dataResponse(OverviewSchema), ...apiErrorResponses },
    }),
    allow('read'),
    apiValidator('query', OverviewQuery),
    async (context) => {
      const { days } = context.req.valid('query');
      const data = await monitoring().overview({ days, publicOnly: false });
      return context.json({ data });
    },
  );

  // --------------------------------------------------------------------------------------------------------------
  // Services
  // --------------------------------------------------------------------------------------------------------------

  routes.get(
    '/services',
    describeRoute({
      tags: TAGS,
      summary: 'List services',
      operationId: 'nocomonitorListServices',
      responses: { '200': listResponse(ServiceSchema), ...apiErrorResponses },
    }),
    allow('read'),
    async (context) => {
      // A bounded configuration list: it is not paged, and says how many it holds.
      const data = await monitoring().listServices();
      return context.json({ data, meta: { total: data.length } });
    },
  );

  routes.post(
    '/services',
    describeRoute({
      tags: TAGS,
      summary: 'Create a service',
      operationId: 'nocomonitorCreateService',
      responses: { '201': dataResponse(ServiceSchema), ...apiErrorResponses, '409': apiErrorResponse(409) },
    }),
    allow('manage'),
    apiValidator('json', ServiceInputSchema),
    async (context) => {
      try {
        const data = await monitoring().createService(context.req.valid('json'));
        return context.json({ data }, 201);
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ApiError({
            status: 'ALREADY_EXISTS',
            reason: 'SERVICE_SLUG_TAKEN',
            domain: DOMAIN,
            message: 'Another service already uses this slug.',
          });
        throw error;
      }
    },
  );

  routes.patch(
    '/services/:serviceId',
    describeRoute({
      tags: TAGS,
      summary: 'Update a service',
      operationId: 'nocomonitorUpdateService',
      responses: { '200': dataResponse(ServiceSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', ServiceParams),
    apiValidator('json', ServicePatchSchema),
    async (context) => {
      const { serviceId } = context.req.valid('param');
      const data = await monitoring().updateService(serviceId, context.req.valid('json'));
      if (!data) throw notFound('SERVICE_NOT_FOUND', `Service ${serviceId} was not found.`);
      return context.json({ data });
    },
  );

  routes.delete(
    '/services/:serviceId',
    describeRoute({
      tags: TAGS,
      summary: 'Delete a service that has no monitors',
      operationId: 'nocomonitorDeleteService',
      responses: { '204': { description: 'Deleted.' }, ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', ServiceParams),
    async (context) => {
      const { serviceId } = context.req.valid('param');
      const outcome = await monitoring().deleteService(serviceId);
      if (outcome === 'notFound') throw notFound('SERVICE_NOT_FOUND', `Service ${serviceId} was not found.`);
      if (outcome === 'hasMonitors')
        throw new ApiError({
          status: 'FAILED_PRECONDITION',
          reason: 'SERVICE_HAS_MONITORS',
          domain: DOMAIN,
          message: 'Delete or move the monitors of this service first.',
        });
      return context.body(null, 204);
    },
  );

  // --------------------------------------------------------------------------------------------------------------
  // Monitors
  // --------------------------------------------------------------------------------------------------------------

  routes.get(
    '/monitors',
    describeRoute({
      tags: TAGS,
      summary: 'List monitors',
      operationId: 'nocomonitorListMonitors',
      responses: { '200': listResponse(MonitorSchema), ...apiErrorResponses },
    }),
    allow('read'),
    async (context) => {
      // Bounded by what administrators configure; not paged.
      const data = await monitoring().listMonitors(context.req.query('serviceId') || undefined);
      return context.json({ data, meta: { total: data.length } });
    },
  );

  routes.post(
    '/monitors',
    describeRoute({
      tags: TAGS,
      summary: 'Create a monitor',
      operationId: 'nocomonitorCreateMonitor',
      responses: { '201': dataResponse(MonitorSchema), ...apiErrorResponses },
    }),
    allow('manage'),
    apiValidator('json', MonitorInputSchema),
    async (context) => {
      const input = context.req.valid('json');
      if (!(await monitoring().getService(input.serviceId)))
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          reason: 'SERVICE_NOT_FOUND',
          domain: DOMAIN,
          message: 'The service does not exist.',
          fieldViolations: [{ field: 'serviceId', description: 'No such service.' }],
        });
      const data = await monitoring().createMonitor(input);
      return context.json({ data }, 201);
    },
  );

  routes.get(
    '/monitors/:monitorId',
    describeRoute({
      tags: TAGS,
      summary: 'Get a monitor with its service, 90-day uptime and recent incidents',
      operationId: 'nocomonitorGetMonitor',
      responses: { '200': dataResponse(MonitorDetailSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('read'),
    apiValidator('param', MonitorParams),
    async (context) => {
      const { monitorId } = context.req.valid('param');
      const service = monitoring();
      const monitor = await service.getMonitor(monitorId);
      if (!monitor) throw notFound('MONITOR_NOT_FOUND', `Monitor ${monitorId} was not found.`);
      const [owner, uptime, incidents] = await Promise.all([
        service.getService(monitor.serviceId),
        service.uptimeByDay([monitor.id], 90, (id) => id),
        service.listIncidents({ state: 'all', page: 1, pageSize: 100 }),
      ]);
      const days = uptime.get(monitor.id) ?? [];
      const total = days.reduce((sum, day) => sum + day.total, 0);
      return context.json({
        data: {
          monitor,
          service: owner,
          days,
          uptime: total ? days.reduce((sum, day) => sum + day.up + day.degraded, 0) / total : null,
          incidents: incidents.rows.filter((incident) => incident.monitorId === monitor.id).slice(0, 20),
        },
      });
    },
  );

  routes.patch(
    '/monitors/:monitorId',
    describeRoute({
      tags: TAGS,
      summary: 'Update a monitor',
      operationId: 'nocomonitorUpdateMonitor',
      responses: { '200': dataResponse(MonitorSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', MonitorParams),
    apiValidator('json', MonitorPatchSchema),
    async (context) => {
      const { monitorId } = context.req.valid('param');
      const input = context.req.valid('json');
      if (input.serviceId && !(await monitoring().getService(input.serviceId)))
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          reason: 'SERVICE_NOT_FOUND',
          domain: DOMAIN,
          message: 'The service does not exist.',
          fieldViolations: [{ field: 'serviceId', description: 'No such service.' }],
        });
      const data = await monitoring().updateMonitor(monitorId, input);
      if (!data) throw notFound('MONITOR_NOT_FOUND', `Monitor ${monitorId} was not found.`);
      return context.json({ data });
    },
  );

  routes.delete(
    '/monitors/:monitorId',
    describeRoute({
      tags: TAGS,
      summary: 'Delete a monitor with its check history',
      operationId: 'nocomonitorDeleteMonitor',
      responses: { '204': { description: 'Deleted.' }, ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', MonitorParams),
    async (context) => {
      const { monitorId } = context.req.valid('param');
      if (!(await monitoring().deleteMonitor(monitorId)))
        throw notFound('MONITOR_NOT_FOUND', `Monitor ${monitorId} was not found.`);
      return context.body(null, 204);
    },
  );

  routes.post(
    '/monitors/:monitorId/check',
    describeRoute({
      tags: TAGS,
      summary: 'Probe a monitor now',
      operationId: 'nocomonitorCheckMonitor',
      responses: { '200': dataResponse(CheckSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', MonitorParams),
    async (context) => {
      const { monitorId } = context.req.valid('param');
      if (!(await monitoring().getMonitor(monitorId)))
        throw notFound('MONITOR_NOT_FOUND', `Monitor ${monitorId} was not found.`);
      const outcome = await monitoring().checkMonitor(monitorId);
      if (!outcome)
        throw new ApiError({
          status: 'ABORTED',
          reason: 'CHECK_IN_PROGRESS',
          domain: DOMAIN,
          message: 'This monitor is being checked right now.',
        });
      return context.json({ data: outcome.check });
    },
  );

  routes.get(
    '/monitors/:monitorId/checks',
    describeRoute({
      tags: TAGS,
      summary: 'List the recent checks of a monitor, oldest first',
      operationId: 'nocomonitorListMonitorChecks',
      responses: { '200': listResponse(CheckSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('read'),
    apiValidator('param', MonitorParams),
    apiValidator('query', ChecksQuery),
    async (context) => {
      const { monitorId } = context.req.valid('param');
      const { hours } = context.req.valid('query');
      if (!(await monitoring().getMonitor(monitorId)))
        throw notFound('MONITOR_NOT_FOUND', `Monitor ${monitorId} was not found.`);
      // A time-bounded chart series rather than a paged table: capped at 2000 points.
      const data = await monitoring().listChecks(monitorId, new Date(Date.now() - hours * 3_600_000));
      return context.json({ data, meta: { total: data.length, hours } });
    },
  );

  // --------------------------------------------------------------------------------------------------------------
  // Incidents
  // --------------------------------------------------------------------------------------------------------------

  routes.get(
    '/incidents',
    describeRoute({
      tags: TAGS,
      summary: 'List incidents, newest first',
      operationId: 'nocomonitorListIncidents',
      responses: { '200': listResponse(IncidentSchema), ...apiErrorResponses },
    }),
    allow('read'),
    apiValidator('query', IncidentListQuery),
    async (context) => {
      const query = context.req.valid('query');
      const { rows, total } = await monitoring().listIncidents(query);
      return context.json({ data: rows, meta: { page: query.page, pageSize: query.pageSize, total } });
    },
  );

  routes.post(
    '/incidents',
    describeRoute({
      tags: TAGS,
      summary: 'Open an incident by hand',
      operationId: 'nocomonitorCreateIncident',
      responses: { '201': dataResponse(IncidentSchema), ...apiErrorResponses },
    }),
    allow('manage'),
    apiValidator('json', IncidentInputSchema),
    async (context) => {
      const input = context.req.valid('json');
      const service = monitoring();
      if (!(await service.getService(input.serviceId)))
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          reason: 'SERVICE_NOT_FOUND',
          domain: DOMAIN,
          message: 'The service does not exist.',
          fieldViolations: [{ field: 'serviceId', description: 'No such service.' }],
        });
      if (input.monitorId) {
        const monitor = await service.getMonitor(input.monitorId);
        if (!monitor || monitor.serviceId !== input.serviceId)
          throw new ApiError({
            status: 'INVALID_ARGUMENT',
            reason: 'MONITOR_NOT_FOUND',
            domain: DOMAIN,
            message: 'The monitor does not exist or belongs to another service.',
            fieldViolations: [{ field: 'monitorId', description: 'No such monitor in this service.' }],
          });
      }
      const data = await service.openManualIncident({ ...input, actor: actorOf(context) });
      return context.json({ data }, 201);
    },
  );

  routes.get(
    '/incidents/:incidentId',
    describeRoute({
      tags: TAGS,
      summary: 'Get an incident with its timeline',
      operationId: 'nocomonitorGetIncident',
      responses: { '200': dataResponse(IncidentDetailSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('read'),
    apiValidator('param', IncidentParams),
    async (context) => {
      const { incidentId } = context.req.valid('param');
      const service = monitoring();
      const incident = await service.getIncident(incidentId);
      if (!incident) throw new IncidentNotFoundError(incidentId);
      const [owner, monitor, updates] = await Promise.all([
        service.getService(incident.serviceId),
        incident.monitorId ? service.getMonitor(incident.monitorId) : Promise.resolve(null),
        service.listIncidentUpdates(incidentId),
      ]);
      return context.json({ data: { incident, service: owner, monitor, updates } });
    },
  );

  routes.patch(
    '/incidents/:incidentId',
    describeRoute({
      tags: TAGS,
      summary: 'Update the title, severity or visibility of an incident',
      operationId: 'nocomonitorUpdateIncident',
      responses: { '200': dataResponse(IncidentSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', IncidentParams),
    apiValidator('json', IncidentPatchSchema),
    async (context) => {
      const { incidentId } = context.req.valid('param');
      const data = await monitoring().updateIncident(incidentId, context.req.valid('json'));
      return context.json({ data });
    },
  );

  routes.post(
    '/incidents/:incidentId/updates',
    describeRoute({
      tags: TAGS,
      summary: 'Post an update to an incident, optionally moving it to another status',
      operationId: 'nocomonitorCreateIncidentUpdate',
      responses: { '201': dataResponse(IncidentUpdateSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', IncidentParams),
    apiValidator('json', IncidentUpdateInputSchema),
    async (context) => {
      const { incidentId } = context.req.valid('param');
      const { update } = await monitoring().postIncidentUpdate(incidentId, {
        ...context.req.valid('json'),
        actor: actorOf(context),
      });
      return context.json({ data: update }, 201);
    },
  );

  // --------------------------------------------------------------------------------------------------------------
  // Status pages
  // --------------------------------------------------------------------------------------------------------------

  routes.get(
    '/statusPages',
    describeRoute({
      tags: TAGS,
      summary: 'List status pages',
      operationId: 'nocomonitorListStatusPages',
      responses: { '200': listResponse(StatusPageSchema), ...apiErrorResponses },
    }),
    allow('read'),
    async (context) => {
      const data = await monitoring().listStatusPages();
      return context.json({ data, meta: { total: data.length } });
    },
  );

  routes.post(
    '/statusPages',
    describeRoute({
      tags: TAGS,
      summary: 'Create a status page',
      operationId: 'nocomonitorCreateStatusPage',
      responses: { '201': dataResponse(StatusPageSchema), ...apiErrorResponses, '409': apiErrorResponse(409) },
    }),
    allow('manage'),
    apiValidator('json', StatusPageInputSchema),
    async (context) => {
      try {
        const data = await monitoring().createStatusPage(context.req.valid('json'));
        return context.json({ data }, 201);
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ApiError({
            status: 'ALREADY_EXISTS',
            reason: 'STATUS_PAGE_SLUG_TAKEN',
            domain: DOMAIN,
            message: 'Another status page already uses this slug.',
          });
        throw error;
      }
    },
  );

  routes.patch(
    '/statusPages/:statusPageId',
    describeRoute({
      tags: TAGS,
      summary: 'Update a status page',
      operationId: 'nocomonitorUpdateStatusPage',
      responses: { '200': dataResponse(StatusPageSchema), ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', StatusPageParams),
    apiValidator('json', StatusPagePatchSchema),
    async (context) => {
      const { statusPageId } = context.req.valid('param');
      const data = await monitoring().updateStatusPage(statusPageId, context.req.valid('json'));
      if (!data) throw notFound('STATUS_PAGE_NOT_FOUND', `Status page ${statusPageId} was not found.`);
      return context.json({ data });
    },
  );

  routes.delete(
    '/statusPages/:statusPageId',
    describeRoute({
      tags: TAGS,
      summary: 'Delete a status page',
      operationId: 'nocomonitorDeleteStatusPage',
      responses: { '204': { description: 'Deleted.' }, ...apiErrorResponses, '404': apiErrorResponse(404) },
    }),
    allow('manage'),
    apiValidator('param', StatusPageParams),
    async (context) => {
      const { statusPageId } = context.req.valid('param');
      if (!(await monitoring().deleteStatusPage(statusPageId)))
        throw notFound('STATUS_PAGE_NOT_FOUND', `Status page ${statusPageId} was not found.`);
      return context.body(null, 204);
    },
  );

  router.route('/', routes);
  return router;
});
