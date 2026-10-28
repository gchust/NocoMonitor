import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  agentsToken,
  runIdentityOf,
  type CallerIdentity,
} from '@nocobase/app-plugin-agents/server/tokens';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponse,
  apiErrorResponses,
  apiValidator,
  cliRoute,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';
import { Hono, type Context, type MiddlewareHandler } from 'hono';

import {
  INCIDENT_DIAGNOSE,
  INCIDENT_READ,
  INCIDENT_REMEDIATE,
} from '../agents/incident-agent.js';
import { RemediationError } from '../monitoring/remediation.js';
import type { Actor } from '../monitoring/types.js';
import { incidentAgentsToken } from '../providers/agents.js';
import {
  monitoringServiceToken,
  remediationServiceToken,
} from '../providers/monitoring.js';
import { DOMAIN } from './monitoring.js';
import {
  AgentIncidentContextSchema,
  DiagnosisInputSchema,
  IncidentSchema,
  ProbeResultSchema,
  RemediationRequestSchema,
  RemediationSchema,
} from './schemas.js';

const TAGS = ['NocoMonitor agents'];
const SECURITY = [{ runToken: [] }];

/**
 * The commands a diagnosis run calls with its run token (`nocomonitor incident …`). Each acts on the run's own incident
 * only: the incident is the run's subject, never a parameter, so an agent cannot reach another one.
 */
export const agentIncidentRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    const routes = new Hono<AuthEnv>();
    const auth = app.container.resolve(authenticationToken);
    const agents = () => app.container.resolve(agentsToken);
    const monitoring = () => app.container.resolve(monitoringServiceToken);

    routes.onError((error, context) =>
      apiErrorHandler(
        error instanceof RemediationError
          ? new ApiError({
              status: error.status,
              reason: error.reason,
              domain: DOMAIN,
              message: error.message,
            })
          : error,
        context,
      ),
    );
    // Run tokens are scoped credentials: accept them here, then require a diagnosis run holding the action.
    routes.use('*', auth.required({ scopedKeys: true }));

    const allow =
      (action: string): MiddlewareHandler<AuthEnv> =>
      async (context, next) => {
        const identity = runIdentityOf(context.get('auth'));
        if (!identity || !(await agents().gate.allowed(identity)).has(action))
          throw new ApiError({
            status: 'PERMISSION_DENIED',
            reason: 'INCIDENT_AGENT_DENIED',
            domain: DOMAIN,
            message:
              'This command needs an active NocoMonitor incident run whose agent holds the corresponding capability.',
          });
        await next();
      };

    const runOf = (context: Context<AuthEnv>) => {
      const identity: CallerIdentity = runIdentityOf(context.get('auth'))!;
      const run = identity.run!.run;
      const actor: Actor = {
        type: 'agent',
        id: run.agentId,
        name: identity.agent?.name ?? identity.displayName,
      };
      return { incidentId: run.subjectId, runId: run.id, actor };
    };

    routes.get(
      '/context',
      allow(INCIDENT_READ),
      describeRoute({
        tags: TAGS,
        summary: 'Read the incident this run diagnoses',
        description:
          'The incident, its service (repository, runbook), the failing monitor and its last 50 checks, the service’s other monitors, the timeline, and the fixes this run may request.',
        operationId: 'nocomonitorAgentIncidentContext',
        security: SECURITY,
        responses: {
          '200': dataResponse(AgentIncidentContextSchema),
          ...apiErrorResponses,
        },
        ...cliRoute({ command: 'incident context', action: INCIDENT_READ }),
      }),
      async (context) => {
        const { incidentId } = runOf(context);
        const db = app.container.resolve(databaseManagerToken);
        const { data } = await db.transaction((conn) =>
          app.container
            .resolve(incidentAgentsToken)
            .context(conn, incidentId, 50),
        );
        return context.json({ data });
      },
    );

    routes.post(
      '/probe',
      allow(INCIDENT_READ),
      describeRoute({
        tags: TAGS,
        summary: 'Probe the failing monitor again now',
        description:
          'Runs the monitor’s check once, as configured, and records it like any scheduled check.',
        operationId: 'nocomonitorAgentIncidentProbe',
        security: SECURITY,
        responses: {
          '200': dataResponse(ProbeResultSchema),
          ...apiErrorResponses,
          '409': apiErrorResponse(409),
        },
        ...cliRoute({ command: 'incident probe', action: INCIDENT_READ }),
      }),
      async (context) => {
        const { incidentId } = runOf(context);
        const incident = await monitoring().getIncident(incidentId);
        const outcome = incident?.monitorId
          ? await monitoring().checkMonitor(incident.monitorId)
          : null;
        if (!outcome)
          throw new ApiError({
            status: 'FAILED_PRECONDITION',
            reason: 'NOTHING_TO_PROBE',
            domain: DOMAIN,
            message:
              'This incident has no monitor, or its monitor is being probed right now; read the context instead.',
          });
        const { check } = outcome;
        return context.json({
          data: {
            status: check.status,
            httpStatus: check.httpStatus,
            latencyMs: check.latencyMs,
            error: check.error,
            details: check.details,
          },
        });
      },
    );

    routes.post(
      '/diagnosis',
      allow(INCIDENT_DIAGNOSE),
      describeRoute({
        tags: TAGS,
        summary: 'Record the diagnosis of the incident',
        description:
          'Send {"summary", "rootCause", "confidence": "low"|"medium"|"high", "verdict": "outage"|"falseAlarm", "suggestedActions": [{"title", "description", "risk", "command"}]} (or --content-file diagnosis.json). Recording again replaces the previous diagnosis.',
        operationId: 'nocomonitorAgentIncidentDiagnosis',
        security: SECURITY,
        responses: {
          '200': dataResponse(IncidentSchema),
          ...apiErrorResponses,
        },
        ...cliRoute({
          command: 'incident diagnose',
          action: INCIDENT_DIAGNOSE,
          // `--content-file diagnosis.json` sends the whole diagnosis, as the agents' instructions say.
          bodyFile: 'content-file',
          examples: ['incident diagnose --content-file diagnosis.json'],
        }),
      }),
      apiValidator('json', DiagnosisInputSchema),
      async (context) => {
        const { incidentId, actor } = runOf(context);
        const input = context.req.valid('json');
        const data = await monitoring().recordDiagnosis(incidentId, {
          ...input,
          actor,
        });
        return context.json({ data });
      },
    );

    routes.post(
      '/remediation',
      allow(INCIDENT_REMEDIATE),
      describeRoute({
        tags: TAGS,
        summary: 'Request one of the service’s fixes',
        description:
          'Names a fix from the context’s remediation.actions by key, with the evidence for it. The monitor’s tier decides: refused (diagnose or suggest only), pending a person’s approval, or applied at once. The probes then verify the service recovered.',
        operationId: 'nocomonitorAgentIncidentRemediation',
        security: SECURITY,
        responses: {
          '201': dataResponse(RemediationSchema),
          ...apiErrorResponses,
          '409': apiErrorResponse(409),
        },
        ...cliRoute({
          command: 'incident remediate',
          action: INCIDENT_REMEDIATE,
          examples: [
            'incident remediate --action restart --reason "All regions return 502 since 10:02; the app container stopped responding"',
          ],
        }),
      }),
      apiValidator('json', RemediationRequestSchema),
      async (context) => {
        const { incidentId, runId, actor } = runOf(context);
        const input = context.req.valid('json');
        const data = await app.container
          .resolve(remediationServiceToken)
          .request({
            incidentId,
            actionKey: input.action,
            reason: input.reason,
            actor,
            runId,
          });
        return context.json({ data }, 201);
      },
    );

    router.route('/monitorAgent/incident', routes);
    return router;
  });
