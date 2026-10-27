import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponse,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import { serviceHealth, type ServiceHealth } from '../monitoring/service.js';
import { monitoringServiceToken } from '../providers/monitoring.js';
import { PublicStatusParams, PublicStatusSchema } from './schemas.js';

const HEALTH_ORDER: readonly ServiceHealth[] = [
  'majorOutage',
  'partialOutage',
  'degraded',
  'maintenance',
  'operational',
  'unknown',
];

/**
 * The public status page's data. Public by design: a status page is read by anyone, signed in or not. It answers only
 * what a published page lists — no URLs, errors, latencies or agent output — and incidents and updates marked public.
 */
export const publicStatusRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    router.onError(apiErrorHandler);

    router.get(
      '/publicStatusPages/:slug',
      describeRoute({
        tags: ['NocoMonitor'],
        summary: 'Read a published status page',
        operationId: 'nocomonitorReadPublicStatusPage',
        security: [],
        responses: {
          '200': dataResponse(PublicStatusSchema),
          '404': apiErrorResponse(404),
          '500': apiErrorResponse(500),
        },
      }),
      apiValidator('param', PublicStatusParams),
      async (context) => {
        const { slug } = context.req.valid('param');
        const monitoring = app.container.resolve(monitoringServiceToken);
        const page = await monitoring.getStatusPage(slug);
        if (!page || !page.published)
          throw new ApiError({
            status: 'NOT_FOUND',
            reason: 'STATUS_PAGE_NOT_FOUND',
            domain: 'nocomonitor',
            message: `No published status page is called ${slug}.`,
          });
        const overview = await monitoring.overview({
          serviceIds: page.serviceIds,
          days: 90,
          publicOnly: true,
        });
        const updates = await monitoring.listUpdatesFor(
          overview.incidents.map((incident) => incident.id),
          true,
        );
        const services = overview.services.map((entry) => ({
          id: entry.service.id,
          name: entry.service.name,
          description: entry.service.description,
          health: entry.health,
          uptime: entry.uptime,
          days: entry.days,
          components: entry.monitors.map((monitor) => ({
            name: monitor.name,
            region: monitor.region,
            status: monitor.status,
          })),
        }));
        const worst = services.length
          ? HEALTH_ORDER.find((health) =>
              services.some((service) => service.health === health),
            )!
          : serviceHealth([]);
        context.header('cache-control', 'public, max-age=30');
        return context.json({
          data: {
            page: {
              slug: page.slug,
              title: page.title,
              description: page.description,
            },
            health: worst,
            services,
            incidents: overview.incidents.map((incident) => ({
              id: incident.id,
              serviceId: incident.serviceId,
              title: incident.title,
              status: incident.status,
              severity: incident.severity,
              startedAt: incident.startedAt,
              resolvedAt: incident.resolvedAt,
              updates: (updates.get(incident.id) ?? []).map((update) => ({
                status: update.status,
                body: update.body,
                createdAt: update.createdAt,
              })),
            })),
            generatedAt: new Date(),
          },
        });
      },
    );

    return router;
  });
