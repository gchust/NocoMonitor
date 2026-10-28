import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import type { Application } from '@nocobase/app-server/application';
import {
  apiErrorHandler,
  apiErrorResponse,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { z } from 'zod';

import { drillServiceToken } from '../providers/monitoring.js';
import { allow, notFound, type Env } from './monitoring.js';
import { DrillSchema, DrillTargetParams } from './schemas.js';

const TAGS = ['NocoMonitor'];

/**
 * The drill: starting, following and ending it (monitoring `read` to follow, `manage` to start or end), and the target
 * its health check probes. The target is public, because the probes call it without a session, and answers only to the
 * drill's random token: anything else is a 404 that tells nothing.
 */
export const drillRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    const routes = new Hono<Env>();
    const authentication = app.container.resolve(authenticationToken);
    const authorization = app.container.resolve(authorizationToken);
    const drill = () => app.container.resolve(drillServiceToken);
    router.onError(apiErrorHandler);
    routes.onError(apiErrorHandler);

    // The target first: its paths sit below `/monitoringDrill` but take no session.
    router.get(
      '/monitoringDrill/:token/health',
      describeRoute({
        tags: TAGS,
        summary: 'The drill target’s health check',
        description:
          'Answers 503 while the drill’s outage lasts and 200 once its fix ran. Public, guarded by the drill’s token.',
        operationId: 'nocomonitorDrillHealth',
        responses: {
          '200': dataResponse(z.object({ status: z.literal('ok') })),
          '404': apiErrorResponse(404),
          '503': apiErrorResponse(503),
        },
      }),
      apiValidator('param', DrillTargetParams),
      async (context) => {
        const target = await drill().target(context.req.valid('param').token);
        if (!target) throw notFound('NOT_FOUND', 'Not found.');
        if (!target.healthy)
          return context.json(
            {
              error: {
                code: 503,
                status: 'UNAVAILABLE',
                reason: 'DRILL_OUTAGE',
                message:
                  'This is a NocoMonitor drill: the target fails until the fix “recover” runs.',
              },
            },
            503,
          );
        return context.json({ data: { status: 'ok' as const } });
      },
    );

    router.post(
      '/monitoringDrill/:token/recover',
      describeRoute({
        tags: TAGS,
        summary: 'The drill’s fix: recover the drill target',
        operationId: 'nocomonitorDrillRecover',
        responses: {
          '200': dataResponse(z.object({ status: z.literal('recovered') })),
          '404': apiErrorResponse(404),
        },
      }),
      apiValidator('param', DrillTargetParams),
      async (context) => {
        if (!(await drill().recover(context.req.valid('param').token)))
          throw notFound('NOT_FOUND', 'Not found.');
        return context.json({ data: { status: 'recovered' as const } });
      },
    );

    // Exactly `/monitoringDrill`: the target's paths above stay public.
    routes.use(
      '/monitoringDrill',
      authentication.required(),
      authorization.middleware(),
    );

    routes.get(
      '/monitoringDrill',
      describeRoute({
        tags: TAGS,
        summary: 'Read the drill',
        description:
          'Whether a drill runs, and when each step of its automatic response happened.',
        operationId: 'nocomonitorReadDrill',
        responses: { '200': dataResponse(DrillSchema), ...apiErrorResponses },
      }),
      allow('read'),
      async (context) => context.json({ data: await drill().status() }),
    );

    routes.post(
      '/monitoringDrill',
      describeRoute({
        tags: TAGS,
        summary: 'Start a drill',
        description:
          'Creates the drill service, its failing health check and its fix, ending a drill already running. The probes open an incident within one interval.',
        operationId: 'nocomonitorStartDrill',
        responses: { '200': dataResponse(DrillSchema), ...apiErrorResponses },
      }),
      allow('manage'),
      async (context) => {
        const config = app.config as unknown as {
          get(path: string): unknown;
        };
        // The server probes itself: at the public origin when one is set, else where this request reached it.
        const origin =
          (config.get('app.publicOrigin') as string | undefined) ??
          new URL(context.req.url).origin;
        const apiUrl = `${origin.replace(/\/+$/u, '')}${(config.get('app.publicApiUrl') as string | undefined) ?? '/api'}`;
        return context.json({ data: await drill().start(apiUrl) });
      },
    );

    routes.delete(
      '/monitoringDrill',
      describeRoute({
        tags: TAGS,
        summary: 'End the drill',
        description:
          'Deletes the drill service with its monitor, checks, incidents, fixes and updates.',
        operationId: 'nocomonitorEndDrill',
        responses: { '200': dataResponse(DrillSchema), ...apiErrorResponses },
      }),
      allow('manage'),
      async (context) => {
        await drill().end();
        return context.json({ data: await drill().status() });
      },
    );

    router.route('/', routes);
    return router;
  });
