// @vitest-environment node
// Setting up monitoring by talking to an agent: a person says what to monitor, the agent answers with questions or a
// proposal through its run-token commands, and the person applies the proposal, which creates it as they chose.
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import {
  agentsToken,
  type CallerIdentity,
  type SubjectAssembly,
} from '@nocobase/app-plugin-agents/server/tokens';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';

import {
  INCIDENT_ACTIONS,
  INCIDENT_SUBJECT,
} from '../../server/agents/incident-agent.js';
import {
  SETUP_ACTIONS,
  SETUP_SUBJECT,
} from '../../server/agents/setup-agent.js';
import { setupAgentsToken } from '../../server/providers/agents.js';
import {
  monitoringServiceToken,
  remediationServiceToken,
} from '../../server/providers/monitoring.js';
import { SetupReplyInputSchema } from '../../server/routes/schemas.js';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'test-auth-secret-at-least-32-characters' },
  },
});

type TestApp = Parameters<Parameters<typeof test>[1]>[0]['app'];

const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', origin: 'http://localhost' },
  body: JSON.stringify(body),
});

/** An agent chosen in AI settings, and runs that are only recorded: no runner takes them in a test. */
async function withAgent(app: TestApp) {
  await app.container.resolve(remediationServiceToken).saveAiSettings(
    {
      enabled: true,
      agentId: 'agent-1',
      actorUserId: null,
      actorName: null,
      language: null,
    },
    null,
  );
  let count = 0;
  const enqueue = vi.fn(() => {
    count += 1;
    return Promise.resolve({
      runId: `run-${count}`,
      outcome: 'created' as const,
      status: 'queued' as const,
      inputId: `input-${count}`,
    });
  });
  const runs = app.container.resolve(agentsToken).runs as unknown as {
    enqueue: typeof enqueue;
  };
  runs.enqueue = enqueue;
  return enqueue;
}

async function existingService(app: TestApp, name: string, slug: string) {
  return app.container.resolve(monitoringServiceToken).createService({
    name,
    slug,
    description: null,
    groupName: null,
    repoUrl: null,
    runbook: null,
    remediations: null,
    sortOrder: 0,
  });
}

const monitor = (service: string, name: string, url: string) => ({
  service,
  name,
  type: 'json' as const,
  url,
  method: 'GET' as const,
  expectedStatus: '200-299',
  keyword: null,
  jsonPath: 'status',
  jsonExpected: 'ok',
  intervalSec: 60,
  timeoutMs: 10000,
  degradedLatencyMs: null,
  autoDiagnose: true,
  note: 'The health endpoint answers {"status":"ok"}.',
});

test('a person asks, the agent proposes, and applying creates what they chose', async ({
  app,
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const setups = app.container.resolve(setupAgentsToken);
  const monitoring = app.container.resolve(monitoringServiceToken);

  // Without an agent chosen in AI settings, nothing starts.
  const refused = await admin.fetch(
    '/monitoringSetups',
    json({ kind: 'monitors', text: 'Monitor the shop', language: 'en-US' }),
  );
  expect(refused.status).toBe(400);
  expect((await refused.json()).error.reason).toBe('AI_NOT_CONFIGURED');

  const enqueue = await withAgent(app);
  const shop = await existingService(app, 'Shop', 'shop');
  await monitoring.createStatusPage({
    slug: 'status',
    title: 'Taken',
    description: null,
    serviceIds: [],
    published: true,
  });

  const started = await admin.fetch(
    '/monitoringSetups',
    json({
      kind: 'monitors',
      text: 'Monitor the shop and its API',
      language: 'en-US',
    }),
  );
  expect(started.status).toBe(201);
  const setup = (await started.json()).data;
  expect(setup).toMatchObject({
    state: 'queued',
    runId: 'run-1',
    turns: [{ role: 'user', text: 'Monitor the shop and its API' }],
  });
  expect(enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: 'agent-1',
      subject: { kind: SETUP_SUBJECT, id: setup.id },
    }),
  );

  // The person waits for the answer before saying more.
  const early = await admin.fetch(
    `/monitoringSetups/${setup.id}/messages`,
    json({ text: 'Also the blog' }),
  );
  expect(early.status).toBe(409);

  // A run the conversation moved on from cannot answer it.
  await expect(
    setups.reply(setup.id, 'run-old', {
      message: 'Late',
      questions: [],
      proposal: null,
    }),
  ).rejects.toMatchObject({ reason: 'SETUP_CLOSED' });

  await setups.reply(
    setup.id,
    'run-1',
    SetupReplyInputSchema.parse({
      message: 'Both answer. I propose two monitors and a status page.',
      questions: [{ text: 'Is the blog yours too?', options: ['Yes', 'No'] }],
      proposal: {
        services: [
          { key: 'shop', existingId: shop.id, name: 'Shop' },
          { key: 'api', name: 'Shop API' },
        ],
        monitors: [
          monitor('shop', 'Shop health', 'https://shop.example.test/health'),
          monitor('api', 'API health', 'https://api.example.test/health'),
        ],
        statusPage: {
          title: 'Shop status',
          slug: 'status',
          services: ['shop', 'api'],
        },
      },
    }),
  );
  const replied = (
    await (await admin.fetch(`/monitoringSetups/${setup.id}`)).json()
  ).data;
  expect(replied.state).toBe('replied');
  expect(replied.turns.at(-1)).toMatchObject({
    role: 'agent',
    runId: 'run-1',
    questions: [{ id: 'q1', text: 'Is the blog yours too?' }],
  });

  // Choosing nothing creates nothing.
  const empty = await admin.fetch(
    `/monitoringSetups/${setup.id}/apply`,
    json({ monitors: [], statusPage: false }),
  );
  expect((await empty.json()).error.reason).toBe('NOTHING_TO_APPLY');

  // Only the API monitor and the page: the shop is used as it is, the API service is new, the slug taken gets a suffix.
  const applied = await admin.fetch(
    `/monitoringSetups/${setup.id}/apply`,
    json({ monitors: [1], statusPage: true }),
  );
  expect(applied.status).toBe(200);
  const result = (await applied.json()).data;
  expect(result.state).toBe('applied');
  expect(result.result.chosen).toEqual({ monitors: [1], statusPage: true });
  expect(result.result.serviceIds).toHaveLength(1);
  const api = await monitoring.getService(result.result.serviceIds[0]);
  expect(api).toMatchObject({ name: 'Shop API', slug: 'shop-api' });
  const monitors = await monitoring.listMonitors(api!.id);
  expect(monitors.map((item) => item.url)).toEqual([
    'https://api.example.test/health',
  ]);
  expect(await monitoring.listMonitors(shop.id)).toEqual([]);
  expect(monitors[0]).toMatchObject({
    serviceId: api!.id,
    type: 'json',
    jsonPath: 'status',
    enabled: true,
    autoDiagnose: true,
    remediationLevel: 'off',
  });
  const page = (await monitoring.listStatusPages()).find(
    (item) => item.id === result.result.statusPageId,
  );
  expect(page).toMatchObject({ slug: 'status-2', title: 'Shop status' });
  expect(page?.serviceIds).toEqual([shop.id, api!.id]);

  // An applied setup is finished.
  const again = await admin.fetch(
    `/monitoringSetups/${setup.id}/apply`,
    json({ monitors: [0], statusPage: false }),
  );
  expect((await again.json()).error.reason).toBe('SETUP_CLOSED');
  const later = await admin.fetch(
    `/monitoringSetups/${setup.id}/messages`,
    json({ text: 'One more' }),
  );
  expect((await later.json()).error.reason).toBe('SETUP_CLOSED');
});

test('an answer wakes the agent again with the whole conversation', async ({
  app,
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const setups = app.container.resolve(setupAgentsToken);
  const enqueue = await withAgent(app);
  const setup = (
    await (
      await admin.fetch(
        '/monitoringSetups',
        json({ kind: 'monitors', text: 'Monitor our CRM', language: 'zh-CN' }),
      )
    ).json()
  ).data;
  await setups.reply(setup.id, 'run-1', {
    message: 'Where does the CRM run?',
    questions: [{ text: 'Its address?', options: [] }],
    proposal: null,
  });
  const answered = await admin.fetch(
    `/monitoringSetups/${setup.id}/messages`,
    json({ text: 'Its address?\n→ https://crm.example.test' }),
  );
  expect(answered.status).toBe(200);
  expect((await answered.json()).data).toMatchObject({
    state: 'queued',
    runId: 'run-2',
  });
  expect(enqueue).toHaveBeenCalledTimes(2);

  const assembly = await app.container
    .resolve(databaseManagerToken)
    .transaction((conn) =>
      (
        setups as unknown as {
          assemble(
            conn: DatabaseConnection,
            id: string,
            cli: string,
          ): Promise<SubjectAssembly>;
        }
      ).assemble(conn, setup.id, 'nocomonitor'),
    );
  expect(assembly.turn.prompt).toBe('Its address?\n→ https://crm.example.test');
  expect(assembly.readOnly).toBe(true);
  const rules = assembly.guidance?.rules?.join('\n') ?? '';
  expect(rules).toContain('Simplified Chinese (简体中文)');
  expect(rules).toContain('setup reply');
  expect(rules).toContain('Never ask for passwords, tokens or other secrets');
  expect(
    (assembly.data as { conversation: { from: string }[] }).conversation.map(
      (turn) => turn.from,
    ),
  ).toEqual(['person', 'you', 'person']);
});

test('each subject’s commands belong to runs on that subject', async ({
  app,
}) => {
  const setups = app.container.resolve(setupAgentsToken);
  await withAgent(app);
  const setup = await setups.start(
    { id: 'user-1', name: 'Ops' },
    { kind: 'statusPage', text: 'A public page', language: 'en-US' },
  );
  const gate = app.container.resolve(agentsToken).gate;
  const identity = (subjectKind: string, subjectId: string) =>
    ({
      kind: 'run',
      run: { run: { subjectKind, subjectId } },
      agent: { actions: [...INCIDENT_ACTIONS, ...SETUP_ACTIONS] },
    }) as unknown as CallerIdentity;

  // The plugin's own actions every run holds aside.
  const own = async (kind: string, id: string) =>
    [...(await gate.allowed(identity(kind, id)))].filter((action) =>
      action.startsWith('nocomonitor.'),
    );
  expect(await own(SETUP_SUBJECT, setup.id)).toEqual([...SETUP_ACTIONS]);
  expect(await own(SETUP_SUBJECT, 'missing')).toEqual([]);
  // A diagnosis run on an incident that does not exist holds neither.
  expect(await own(INCIDENT_SUBJECT, setup.id)).toEqual([]);
});

test('a proposal names only services it lists', () => {
  const result = SetupReplyInputSchema.safeParse({
    message: 'Here it is',
    proposal: {
      services: [{ key: 'shop', name: 'Shop' }],
      monitors: [monitor('blog', 'Blog', 'https://blog.example.test/')],
    },
  });
  expect(result.success).toBe(false);
  expect(JSON.stringify(result.error?.issues)).toContain(
    'No service has the key',
  );
  // A keyword check needs its keyword.
  const keyword = SetupReplyInputSchema.safeParse({
    message: 'Here it is',
    proposal: {
      services: [{ key: 'shop', name: 'Shop' }],
      monitors: [
        {
          ...monitor('shop', 'Shop', 'https://shop.example.test/'),
          type: 'keyword',
        },
      ],
    },
  });
  expect(keyword.success).toBe(false);
});

test('setups require sign-in and monitoring manage', async ({ testApp }) => {
  expect((await testApp.request('/monitoringSetups', json({}))).status).toBe(
    401,
  );
  expect((await testApp.request('/monitoringSetups/1')).status).toBe(401);

  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  expect((await admin.fetch('/monitoringSetups/missing')).status).toBe(404);
  const created = await admin.fetch(
    '/users',
    json({
      name: 'outsider',
      username: 'outsider',
      email: 'outsider@example.test',
      password: 'Member-test-123!',
      roleScopes: { app: [] },
    }),
  );
  expect(created.status).toBe(201);
  const outsider = await signIn(testApp, {
    username: 'outsider',
    password: 'Member-test-123!',
  });
  expect(
    (
      await outsider.fetch(
        '/monitoringSetups',
        json({ kind: 'monitors', text: 'x', language: 'en-US' }),
      )
    ).status,
  ).toBe(403);
  expect((await outsider.fetch('/monitoringSetups/missing')).status).toBe(403);
});
