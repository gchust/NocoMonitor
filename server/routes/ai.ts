import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
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
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import { DiagnosisUnavailableError } from '../agents/incident-agent.js';
import { RemediationError } from '../monitoring/remediation.js';
import { incidentAgentsToken } from '../providers/agents.js';
import {
  monitoringServiceToken,
  remediationServiceToken,
} from '../providers/monitoring.js';
import { actorOf, allow, DOMAIN, notFound, type Env } from './monitoring.js';
import {
  AiSettingsInputSchema,
  AiSettingsSchema,
  DiagnosisStartedSchema,
  IncidentParams,
  RemediationOptionsSchema,
  RemediationParams,
  RemediationRejectSchema,
  RemediationRequestSchema,
  RemediationSchema,
} from './schemas.js';

const TAGS = ['NocoMonitor'];

/**
 * The pages' side of AI: which agent diagnoses and as whom, asking for a diagnosis, and the fixes of an incident —
 * reading them, running one, approving or rejecting what an agent asked for. Reading needs monitoring `read`; every
 * change needs `manage`.
 */
export const aiRoutes: AppApiRouteContribution<Application> = defineApiRoutes(
  (app) => {
    const router = new Hono();
    const routes = new Hono<Env>();
    const authentication = app.container.resolve(authenticationToken);
    const authorization = app.container.resolve(authorizationToken);
    const remediation = () => app.container.resolve(remediationServiceToken);

    routes.onError((error, context) => {
      if (error instanceof RemediationError)
        return apiErrorHandler(
          new ApiError({
            status: error.status,
            reason: error.reason,
            domain: DOMAIN,
            message: error.message,
          }),
          context,
        );
      if (error instanceof DiagnosisUnavailableError)
        return apiErrorHandler(
          new ApiError({
            status:
              error.reason === 'INCIDENT_NOT_FOUND'
                ? 'NOT_FOUND'
                : 'FAILED_PRECONDITION',
            reason: error.reason,
            domain: DOMAIN,
            message: error.message,
          }),
          context,
        );
      return apiErrorHandler(error, context);
    });
    for (const path of [
      '/monitoringAi',
      '/incidents/:incidentId/diagnose',
      '/incidents/:incidentId/remediations',
      '/remediations',
    ]) {
      routes.use(path, authentication.required(), authorization.middleware());
      routes.use(
        `${path}/*`,
        authentication.required(),
        authorization.middleware(),
      );
    }

    routes.get(
      '/monitoringAi/settings',
      describeRoute({
        tags: TAGS,
        summary: 'Read the AI diagnosis settings',
        operationId: 'nocomonitorReadAiSettings',
        responses: {
          '200': dataResponse(AiSettingsSchema),
          ...apiErrorResponses,
        },
      }),
      allow('read'),
      async (context) =>
        context.json({ data: await remediation().aiSettings() }),
    );

    routes.put(
      '/monitoringAi/settings',
      describeRoute({
        tags: TAGS,
        summary: 'Save the AI diagnosis settings',
        description:
          'Automatic diagnoses run as the person who saves these settings: their permissions bound what the agent may do.',
        operationId: 'nocomonitorSaveAiSettings',
        responses: {
          '200': dataResponse(AiSettingsSchema),
          ...apiErrorResponses,
        },
      }),
      allow('manage'),
      apiValidator('json', AiSettingsInputSchema),
      async (context) => {
        const input = context.req.valid('json');
        const actor = actorOf(context);
        const data = await remediation().saveAiSettings(
          {
            enabled: input.enabled,
            agentId: input.agentId,
            actorUserId: input.agentId ? actor.id : null,
            actorName: input.agentId ? actor.name : null,
          },
          actor.id,
        );
        return context.json({ data });
      },
    );

    routes.post(
      '/incidents/:incidentId/diagnose',
      describeRoute({
        tags: TAGS,
        summary: 'Ask the diagnosis agent to investigate an incident',
        operationId: 'nocomonitorDiagnoseIncident',
        responses: {
          '202': dataResponse(DiagnosisStartedSchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
        },
      }),
      allow('manage'),
      apiValidator('param', IncidentParams),
      async (context) => {
        const { incidentId } = context.req.valid('param');
        const actor = actorOf(context);
        const runId = await app.container
          .resolve(incidentAgentsToken)
          .diagnose(
            incidentId,
            'manual',
            actor.id
              ? { id: actor.id, name: actor.name ?? actor.id }
              : undefined,
          );
        return context.json({ data: { runId } }, 202);
      },
    );

    routes.get(
      '/incidents/:incidentId/remediations',
      describeRoute({
        tags: TAGS,
        summary: 'List the fixes of an incident and the ones it allows',
        operationId: 'nocomonitorListRemediations',
        responses: {
          '200': dataResponse(RemediationOptionsSchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
        },
      }),
      allow('read'),
      apiValidator('param', IncidentParams),
      async (context) => {
        const { incidentId } = context.req.valid('param');
        const incident = await app.container
          .resolve(monitoringServiceToken)
          .getIncident(incidentId);
        if (!incident)
          throw notFound(
            'INCIDENT_NOT_FOUND',
            `Incident ${incidentId} was not found.`,
          );
        const [options, remediations] = await Promise.all([
          remediation().optionsFor(incident),
          remediation().listForIncident(incidentId),
        ]);
        return context.json({
          data: {
            level: options.level,
            actions: options.actions.map(({ key, title, description }) => ({
              key,
              title,
              description,
            })),
            remediations,
          },
        });
      },
    );

    routes.post(
      '/incidents/:incidentId/remediations',
      describeRoute({
        tags: TAGS,
        summary: 'Run one of the service’s fixes for an incident',
        operationId: 'nocomonitorRunRemediation',
        responses: {
          '201': dataResponse(RemediationSchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
          '409': apiErrorResponse(409),
        },
      }),
      allow('manage'),
      apiValidator('param', IncidentParams),
      apiValidator('json', RemediationRequestSchema),
      async (context) => {
        const { incidentId } = context.req.valid('param');
        const input = context.req.valid('json');
        const data = await remediation().request({
          incidentId,
          actionKey: input.action,
          reason: input.reason,
          actor: actorOf(context),
        });
        return context.json({ data }, 201);
      },
    );

    routes.post(
      '/remediations/:remediationId/approve',
      describeRoute({
        tags: TAGS,
        summary: 'Approve and run a fix an agent requested',
        operationId: 'nocomonitorApproveRemediation',
        responses: {
          '200': dataResponse(RemediationSchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
        },
      }),
      allow('manage'),
      apiValidator('param', RemediationParams),
      async (context) => {
        const { remediationId } = context.req.valid('param');
        const data = await remediation().approve(
          remediationId,
          actorOf(context),
        );
        return context.json({ data });
      },
    );

    routes.post(
      '/remediations/:remediationId/reject',
      describeRoute({
        tags: TAGS,
        summary: 'Reject a fix an agent requested',
        operationId: 'nocomonitorRejectRemediation',
        responses: {
          '200': dataResponse(RemediationSchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
        },
      }),
      allow('manage'),
      apiValidator('param', RemediationParams),
      apiValidator('json', RemediationRejectSchema),
      async (context) => {
        const { remediationId } = context.req.valid('param');
        const data = await remediation().reject(
          remediationId,
          actorOf(context),
          context.req.valid('json').note,
        );
        return context.json({ data });
      },
    );

    router.route('/', routes);
    return router;
  },
);
