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
import { databaseManagerToken } from '@nocobase/db';
import { Hono } from 'hono';

import { DiagnosisUnavailableError } from '../agents/incident-agent.js';
import { readBriefing } from '../monitoring/briefing.js';
import { RemediationError } from '../monitoring/remediation.js';
import { incidentAgentsToken } from '../providers/agents.js';
import {
  drillServiceToken,
  monitoringServiceToken,
  remediationServiceToken,
} from '../providers/monitoring.js';
import { actorOf, allow, DOMAIN, notFound, type Env } from './monitoring.js';
import {
  AiSettingsInputSchema,
  AiSettingsSchema,
  BriefingQuery,
  BriefingSchema,
  DiagnosisStartedSchema,
  IncidentParams,
  InvestigationActivitySchema,
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
      '/incidents/:incidentId/aiActivity',
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
            language: input.language,
          },
          actor.id,
        );
        return context.json({ data });
      },
    );

    routes.get(
      '/monitoringAi/briefing',
      describeRoute({
        tags: TAGS,
        summary: 'What the AI did lately and what waits on people',
        description:
          'The diagnosis agent and whether it could take work now, what it diagnosed and fixed over the last `days`, the fix approvals and failed diagnoses of open incidents, and the latest diagnosis and fix updates.',
        operationId: 'nocomonitorReadAiBriefing',
        responses: {
          '200': dataResponse(BriefingSchema),
          ...apiErrorResponses,
        },
      }),
      allow('read'),
      apiValidator('query', BriefingQuery),
      async (context) => {
        const { days } = context.req.valid('query');
        const db = app.container.resolve(databaseManagerToken);
        const settings = await remediation().aiSettings();
        // One after the other: on SQLite the transaction holds the only connection the reads would wait for.
        const briefing = await readBriefing(db, {
          days,
          excludeServiceId: await app.container
            .resolve(drillServiceToken)
            .serviceId(),
        });
        const agent = await db.transaction((conn) =>
          app.container
            .resolve(incidentAgentsToken)
            .agentSummary(conn, settings),
        );
        return context.json({ data: { ...briefing, agent } });
      },
    );

    routes.get(
      '/incidents/:incidentId/aiActivity',
      describeRoute({
        tags: TAGS,
        summary: 'How the diagnosis agent investigated an incident',
        description:
          'The steps of the incident’s latest diagnosis run, each classified (read the incident, probe, request, read code, record the diagnosis, request a fix, other command). Commands, their output and the agent’s thinking are never returned.',
        operationId: 'nocomonitorReadInvestigationActivity',
        responses: {
          '200': dataResponse(InvestigationActivitySchema),
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
        const data = await app.container
          .resolve(incidentAgentsToken)
          .activity(incident);
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
