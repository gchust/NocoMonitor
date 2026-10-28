import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { z } from 'zod';

import { AlertError, type AlertService } from '../monitoring/alerts.js';
import { alertServiceToken } from '../providers/monitoring.js';
import { actorOf, allow, DOMAIN, type Env } from './monitoring.js';
import {
  AlertDeliverySchema,
  AlertRecipientQuery,
  AlertRecipientsSchema,
  AlertSettingsInputSchema,
  AlertSettingsSchema,
} from './schemas.js';

const TAGS = ['NocoMonitor'];

/**
 * Alert notifications: who is told about which incident events, through which configured channels, and what was sent
 * lately. Reading needs monitoring `read`; saving, picking recipients and sending a test need `manage`.
 */
export const alertRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    const routes = new Hono<Env>();
    const authentication = app.container.resolve(authenticationToken);
    const authorization = app.container.resolve(authorizationToken);
    const alerts = () => app.container.resolve(alertServiceToken);

    routes.onError((error, context) =>
      apiErrorHandler(
        error instanceof AlertError
          ? new ApiError({
              status: 'FAILED_PRECONDITION',
              reason: error.reason,
              domain: DOMAIN,
              message: error.message,
            })
          : error,
        context,
      ),
    );
    for (const path of ['/monitoringAlerts', '/monitoringAlerts/*'])
      routes.use(path, authentication.required(), authorization.middleware());

    const settingsView = async (service: AlertService) => {
      const settings = await service.settings();
      return {
        ...settings,
        recipients: await service.recipients(settings.recipients),
        available: service.channels(),
      };
    };

    routes.get(
      '/monitoringAlerts/settings',
      describeRoute({
        tags: TAGS,
        summary: 'Read the alert notification settings',
        description:
          'The chosen recipients, channels and events, and every channel configured in `notification.channels`.',
        operationId: 'nocomonitorReadAlertSettings',
        responses: {
          '200': dataResponse(AlertSettingsSchema),
          ...apiErrorResponses,
        },
      }),
      allow('read'),
      async (context) => context.json({ data: await settingsView(alerts()) }),
    );

    routes.put(
      '/monitoringAlerts/settings',
      describeRoute({
        tags: TAGS,
        summary: 'Save the alert notification settings',
        operationId: 'nocomonitorSaveAlertSettings',
        responses: {
          '200': dataResponse(AlertSettingsSchema),
          ...apiErrorResponses,
        },
      }),
      allow('manage'),
      apiValidator('json', AlertSettingsInputSchema),
      async (context) => {
        await alerts().saveSettings(
          context.req.valid('json'),
          actorOf(context).id,
        );
        return context.json({ data: await settingsView(alerts()) });
      },
    );

    routes.get(
      '/monitoringAlerts/recipients',
      describeRoute({
        tags: TAGS,
        summary: 'Find people to alert',
        description:
          'Enabled people (not service accounts) whose name or email matches `q`, at most 20, with their email address.',
        operationId: 'nocomonitorSearchAlertRecipients',
        responses: {
          '200': dataResponse(AlertRecipientsSchema),
          ...apiErrorResponses,
        },
      }),
      allow('manage'),
      apiValidator('query', AlertRecipientQuery),
      async (context) =>
        context.json({
          data: await alerts().searchRecipients(context.req.valid('query').q),
        }),
    );

    routes.post(
      '/monitoringAlerts/test',
      describeRoute({
        tags: TAGS,
        summary: 'Send a test notification',
        description:
          'Sends one message through every chosen channel with the saved settings, and answers what the notification service reports for it.',
        operationId: 'nocomonitorSendTestAlert',
        responses: {
          '200': dataResponse(AlertDeliverySchema),
          ...apiErrorResponses,
        },
      }),
      allow('manage'),
      async (context) => context.json({ data: await alerts().test() }),
    );

    routes.get(
      '/monitoringAlerts/deliveries',
      describeRoute({
        tags: TAGS,
        summary: 'The latest alert notifications',
        description:
          'The last 20 alerts NocoMonitor sent, with each channel’s status. Message bodies and addresses are not returned.',
        operationId: 'nocomonitorListAlertDeliveries',
        responses: {
          '200': dataResponse(z.array(AlertDeliverySchema)),
          ...apiErrorResponses,
        },
      }),
      allow('read'),
      async (context) => context.json({ data: await alerts().deliveries() }),
    );

    router.route('/', routes);
    return router;
  });
