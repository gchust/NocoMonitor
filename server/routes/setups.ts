import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import {
  agentsToken,
  runIdentityOf,
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
  SETUP_READ,
  SETUP_REPLY,
  SetupError,
  type SetupErrorReason,
} from '../agents/setup-agent.js';
import { setupAgentsToken } from '../providers/agents.js';
import { actorOf, allow, DOMAIN, type Env } from './monitoring.js';
import {
  AgentSetupContextSchema,
  ProbeResultSchema,
  SetupActivitySchema,
  SetupApplyInputSchema,
  SetupInputSchema,
  SetupMessageInputSchema,
  SetupParams,
  SetupReplyInputSchema,
  SetupSchema,
  SetupTryInputSchema,
} from './schemas.js';

const TAGS = ['NocoMonitor setup'];
const AGENT_TAGS = ['NocoMonitor agents'];
const SECURITY = [{ runToken: [] }];

const ERROR_STATUS: Record<SetupErrorReason, ApiError['status']> = {
  SETUP_NOT_FOUND: 'NOT_FOUND',
  AI_NOT_CONFIGURED: 'FAILED_PRECONDITION',
  AGENT_UNAVAILABLE: 'FAILED_PRECONDITION',
  SETUP_BUSY: 'ABORTED',
  SETUP_CLOSED: 'FAILED_PRECONDITION',
  NOTHING_TO_APPLY: 'FAILED_PRECONDITION',
  PROPOSAL_STALE: 'FAILED_PRECONDITION',
};

const onError = (error: Error, context: Context) =>
  apiErrorHandler(
    error instanceof SetupError
      ? new ApiError({
          status: ERROR_STATUS[error.reason],
          reason: error.reason,
          domain: DOMAIN,
          message: error.message,
        })
      : error,
    context,
  );

/**
 * Setting up monitoring with an agent: people start a conversation, answer it and apply its proposal
 * (`/monitoringSetups`, which needs the monitoring `manage` action, as creating by hand does); the setup run reads the
 * configuration, tries monitors and answers with its run token (`nocomonitor setup …`), on its own setup only.
 */
export const setupRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const router = new Hono();
    const routes = new Hono<Env>();
    const agentRoutes = new Hono<AuthEnv>();
    const authentication = app.container.resolve(authenticationToken);
    const authorization = app.container.resolve(authorizationToken);
    const setups = () => app.container.resolve(setupAgentsToken);

    routes.onError(onError);
    agentRoutes.onError(onError);
    routes.use('*', authentication.required(), authorization.middleware());

    const person = (context: Context<Env>) => {
      const actor = actorOf(context);
      return { id: actor.id!, name: actor.name };
    };
    const found = async (id: string) => {
      const setup = await setups().get(id);
      if (!setup)
        throw new SetupError('SETUP_NOT_FOUND', 'The setup does not exist.');
      return setup;
    };

    routes.post(
      '/',
      describeRoute({
        tags: TAGS,
        summary: 'Ask the agent to set up monitors or a status page',
        description:
          'Starts a conversation with what the person wants monitored, or the status page they want, and wakes the configured agent on it. Nothing is created until the proposal is applied.',
        operationId: 'nocomonitorCreateSetup',
        responses: {
          '201': dataResponse(SetupSchema),
          ...apiErrorResponses,
        },
      }),
      allow('manage'),
      apiValidator('json', SetupInputSchema),
      async (context) => {
        const data = await setups().start(
          person(context),
          context.req.valid('json'),
        );
        return context.json({ data }, 201);
      },
    );

    routes.get(
      '/:setupId',
      describeRoute({
        tags: TAGS,
        summary: 'Read a setup conversation',
        operationId: 'nocomonitorGetSetup',
        responses: {
          '200': dataResponse(SetupSchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
        },
      }),
      allow('manage'),
      apiValidator('param', SetupParams),
      async (context) => {
        const data = await found(context.req.valid('param').setupId);
        return context.json({ data });
      },
    );

    routes.get(
      '/:setupId/activity',
      describeRoute({
        tags: TAGS,
        summary: 'What the agent is doing on the latest message',
        description:
          'The steps of the run answering the latest message, classified as for a diagnosis: never its commands or their output.',
        operationId: 'nocomonitorGetSetupActivity',
        responses: {
          '200': dataResponse(SetupActivitySchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
        },
      }),
      allow('manage'),
      apiValidator('param', SetupParams),
      async (context) => {
        const setup = await found(context.req.valid('param').setupId);
        return context.json({ data: await setups().activity(setup) });
      },
    );

    routes.post(
      '/:setupId/messages',
      describeRoute({
        tags: TAGS,
        summary: 'Answer the agent, or ask it for a change',
        operationId: 'nocomonitorPostSetupMessage',
        responses: {
          '200': dataResponse(SetupSchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
          '409': apiErrorResponse(409),
        },
      }),
      allow('manage'),
      apiValidator('param', SetupParams),
      apiValidator('json', SetupMessageInputSchema),
      async (context) => {
        const data = await setups().say(
          context.req.valid('param').setupId,
          person(context),
          context.req.valid('json').text,
        );
        return context.json({ data });
      },
    );

    routes.post(
      '/:setupId/apply',
      describeRoute({
        tags: TAGS,
        summary: 'Create what the agent proposed',
        description:
          'Creates the chosen monitors of the latest proposal, the services they use, and its status page when chosen.',
        operationId: 'nocomonitorApplySetup',
        responses: {
          '200': dataResponse(SetupSchema),
          ...apiErrorResponses,
          '404': apiErrorResponse(404),
          '409': apiErrorResponse(409),
        },
      }),
      allow('manage'),
      apiValidator('param', SetupParams),
      apiValidator('json', SetupApplyInputSchema),
      async (context) => {
        const data = await setups().apply(
          context.req.valid('param').setupId,
          context.req.valid('json'),
        );
        return context.json({ data });
      },
    );

    // ------------------------------------------------------------------------------------------------------------
    // The commands a setup run calls
    // ------------------------------------------------------------------------------------------------------------

    // Run tokens are scoped credentials: accept them here, then require a setup run holding the action.
    agentRoutes.use('*', authentication.required({ scopedKeys: true }));

    const permit =
      (action: string): MiddlewareHandler<AuthEnv> =>
      async (context, next) => {
        const identity = runIdentityOf(context.get('auth'));
        if (
          !identity ||
          !(
            await app.container.resolve(agentsToken).gate.allowed(identity)
          ).has(action)
        )
          throw new ApiError({
            status: 'PERMISSION_DENIED',
            reason: 'SETUP_AGENT_DENIED',
            domain: DOMAIN,
            message:
              'This command needs an active NocoMonitor setup run whose agent holds the corresponding capability.',
          });
        await next();
      };
    const runOf = (context: Context<AuthEnv>) => {
      const run = runIdentityOf(context.get('auth'))!.run!.run;
      return { setupId: run.subjectId, runId: run.id };
    };

    agentRoutes.get(
      '/context',
      permit(SETUP_READ),
      describeRoute({
        tags: AGENT_TAGS,
        summary: 'Read the setup this run answers',
        description:
          'The conversation, oldest first, and what is monitored already: services with their monitors, and status pages.',
        operationId: 'nocomonitorAgentSetupContext',
        security: SECURITY,
        responses: {
          '200': dataResponse(AgentSetupContextSchema),
          ...apiErrorResponses,
        },
        ...cliRoute({ command: 'setup context', action: SETUP_READ }),
      }),
      async (context) => {
        const { setupId } = runOf(context);
        const { data } = await app.container
          .resolve(databaseManagerToken)
          .transaction((conn) => setups().context(conn, setupId));
        return context.json({ data });
      },
    );

    agentRoutes.post(
      '/try',
      permit(SETUP_READ),
      describeRoute({
        tags: AGENT_TAGS,
        summary: 'Probe a monitor once before proposing it',
        description:
          'Send {"type", "url", "method", "expectedStatus", "keyword", "jsonPath", "jsonExpected", "timeoutMs", "degradedLatencyMs"} (or --content-file monitor.json). Probes once from where NocoMonitor probes and saves nothing.',
        operationId: 'nocomonitorAgentSetupTry',
        security: SECURITY,
        responses: {
          '200': dataResponse(ProbeResultSchema),
          ...apiErrorResponses,
        },
        ...cliRoute({
          command: 'setup try',
          action: SETUP_READ,
          bodyFile: 'content-file',
          examples: ['setup try --content-file monitor.json'],
        }),
      }),
      apiValidator('json', SetupTryInputSchema),
      async (context) => {
        const data = await setups().tryMonitor(context.req.valid('json'));
        return context.json({ data });
      },
    );

    agentRoutes.post(
      '/reply',
      permit(SETUP_REPLY),
      describeRoute({
        tags: AGENT_TAGS,
        summary: 'Answer the person',
        description:
          'Send {"message", "questions": [{"text", "options"}], "proposal": null or {"services", "monitors", "statusPage"}} (or --content-file reply.json). Answering again in the same run replaces the answer.',
        operationId: 'nocomonitorAgentSetupReply',
        security: SECURITY,
        responses: {
          '200': dataResponse(SetupSchema),
          ...apiErrorResponses,
        },
        ...cliRoute({
          command: 'setup reply',
          action: SETUP_REPLY,
          bodyFile: 'content-file',
          examples: ['setup reply --content-file reply.json'],
        }),
      }),
      apiValidator('json', SetupReplyInputSchema),
      async (context) => {
        const { setupId, runId } = runOf(context);
        const data = await setups().reply(
          setupId,
          runId,
          context.req.valid('json'),
        );
        return context.json({ data });
      },
    );

    router.route('/monitoringSetups', routes);
    router.route('/monitorAgent/setup', agentRoutes);
    return router;
  });
