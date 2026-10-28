// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import type { SubjectAssembly } from '@nocobase/app-plugin-agents/server/tokens';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';

import {
  classifyToolUse,
  investigationSteps,
} from '../../server/agents/incident-agent.js';
import { readBriefing } from '../../server/monitoring/briefing.js';
import { resolveLanguage } from '../../server/monitoring/language.js';
import type { Actor } from '../../server/monitoring/types.js';
import { incidentAgentsToken } from '../../server/providers/agents.js';
import {
  monitoringServiceToken,
  remediationServiceToken,
} from '../../server/providers/monitoring.js';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'test-auth-secret-at-least-32-characters' },
  },
});

const agent: Actor = { type: 'agent', id: 'agent-1', name: 'Diagnoser' };
const person: Actor = { type: 'user', id: 'user-1', name: 'Ops' };
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', origin: 'http://localhost' },
  body: JSON.stringify(body),
});

type TestApp = Parameters<Parameters<typeof test>[1]>[0]['app'];

/** A service allowing one fix and a disabled monitor at `approve`, so the probe loop never reaches the made-up URL. */
async function setUp(app: TestApp, name = 'API') {
  const monitoring = app.container.resolve(monitoringServiceToken);
  const service = await monitoring.createService({
    name: `Service ${name}`,
    slug: `service-${monitoring.newId()}`,
    description: null,
    groupName: null,
    repoUrl: null,
    runbook: null,
    remediations: [
      {
        key: 'restart',
        title: 'Restart',
        description: null,
        method: 'POST',
        url: 'https://deploy.example.test/restart',
        headers: null,
        body: null,
      },
    ],
    sortOrder: 0,
  });
  const monitor = await monitoring.createMonitor({
    serviceId: service.id,
    name,
    type: 'http',
    region: null,
    url: 'https://app.example.test/health',
    method: 'GET',
    headers: null,
    body: null,
    expectedStatus: '200-299',
    keyword: null,
    jsonPath: null,
    jsonExpected: null,
    intervalSec: 60,
    timeoutMs: 5000,
    degradedLatencyMs: null,
    failureThreshold: 1,
    recoveryThreshold: 1,
    enabled: false,
    autoDiagnose: false,
    remediationLevel: 'approve',
    sortOrder: 0,
  });
  return { monitoring, service, monitor };
}

describe('investigation steps', () => {
  it('classifies tool calls by what they did, never keeping the command', () => {
    expect(
      classifyToolUse('Bash', {
        command: 'nocomonitor incident probe --json; curl -s https://x',
      }),
    ).toBe('probe');
    expect(
      classifyToolUse('Bash', { command: 'nocomonitor incident context' }),
    ).toBe('context');
    expect(
      classifyToolUse('Bash', {
        command: 'nocomonitor incident diagnose --content-file d.json',
      }),
    ).toBe('diagnose');
    expect(
      classifyToolUse('Bash', {
        command: 'nocomonitor incident remediate --action restart',
      }),
    ).toBe('remediate');
    expect(
      classifyToolUse('Bash', {
        command: 'curl -H "Authorization: Bearer s3cret" https://x',
      }),
    ).toBe('request');
    expect(classifyToolUse('Bash', { command: 'rg ROUTE repository' })).toBe(
      'code',
    );
    expect(classifyToolUse('Read', { file_path: '/repo/a.ts' })).toBe('code');
    expect(classifyToolUse('Bash', { command: 'date' })).toBe('command');
  });

  it('keeps tool calls only, telling consecutive steps of one kind once', () => {
    const steps = investigationSteps([
      { seq: 1, at: 't1', type: 'input' },
      {
        seq: 2,
        at: 't2',
        type: 'toolUse',
        tool: 'Bash',
        input: { command: 'nocomonitor incident diagnose --x' },
      },
      { seq: 3, at: 't3', type: 'toolResult', tool: 'Bash' },
      {
        seq: 4,
        at: 't4',
        type: 'toolUse',
        tool: 'Bash',
        input: { command: 'nocomonitor incident diagnose --y' },
      },
      { seq: 5, at: 't5', type: 'toolUse', tool: 'Grep', input: {} },
    ]);
    expect(steps).toEqual([
      { seq: 2, at: 't2', kind: 'diagnose' },
      { seq: 5, at: 't5', kind: 'code' },
    ]);
    expect(JSON.stringify(steps)).not.toContain('--x');
  });
});

describe('diagnosis language', () => {
  it('follows the choice, else the application default', () => {
    expect(resolveLanguage('zh-CN', 'en-US')).toBe('zh-CN');
    expect(resolveLanguage(null, 'zh-CN')).toBe('zh-CN');
    expect(resolveLanguage(undefined, 'en-US')).toBe('en-US');
  });
});

test('the briefing counts what the agent did and lists what waits on people', async ({
  app,
}) => {
  const { monitoring, monitor } = await setUp(app);
  const remediation = app.container.resolve(remediationServiceToken);
  const db = app.container.resolve(databaseManagerToken);
  const open = await monitoring.openManualIncident({
    serviceId: monitor.serviceId,
    monitorId: monitor.id,
    title: 'API is down',
    severity: 'major',
    body: 'Down',
    publicVisible: false,
    actor: person,
  });
  const undiagnosed = await monitoring.openManualIncident({
    serviceId: monitor.serviceId,
    monitorId: monitor.id,
    title: 'API is slow',
    severity: 'minor',
    body: 'Slow',
    publicVisible: false,
    actor: person,
  });
  await monitoring.recordDiagnosis(open.id, {
    summary: 'The database pool is exhausted.\nMore detail.',
    rootCause: '- Every check times out',
    confidence: 'high',
    suggestedActions: [],
    actor: agent,
  });
  await remediation.request({
    incidentId: open.id,
    actionKey: 'restart',
    reason: 'Pool exhausted',
    actor: agent,
  });
  await monitoring.setAiState(undiagnosed.id, { aiState: 'failed' });

  const briefing = await readBriefing(db, { days: 7 });
  expect(briefing.stats).toMatchObject({
    incidents: 2,
    diagnosed: 1,
    fixesRequested: 1,
    fixesVerified: 0,
    needsYou: 2,
  });
  expect(briefing.stats.medianTimeToDiagnosisMs).toBeGreaterThanOrEqual(0);
  expect(briefing.needsYou.map((item) => item.kind).sort()).toEqual([
    'approval',
    'diagnosisFailed',
  ]);
  expect(
    briefing.needsYou.find((item) => item.kind === 'approval'),
  ).toMatchObject({
    incidentId: open.id,
    incidentTitle: 'API is down',
    actionTitle: 'Restart',
  });
  expect(briefing.pendingFixes).toEqual([
    { incidentId: open.id, actionTitle: 'Restart' },
  ]);
  // Only the first line of an update reaches the feed.
  expect(briefing.feed.find((item) => item.kind === 'diagnosis')).toMatchObject(
    {
      incidentId: open.id,
      authorType: 'agent',
      text: 'The database pool is exhausted.',
    },
  );

  // A resolved incident waits on no one, its pending fix included.
  await monitoring.postIncidentUpdate(open.id, {
    body: 'Recovered',
    status: 'resolved',
    publicVisible: false,
    actor: person,
  });
  const later = await readBriefing(db, { days: 7 });
  expect(later.needsYou.map((item) => item.kind)).toEqual(['diagnosisFailed']);
  expect(later.pendingFixes).toEqual([]);
});

test('opened incidents and agent instructions use the chosen language', async ({
  app,
}) => {
  const { monitoring, monitor } = await setUp(app, 'Checkout');
  const remediation = app.container.resolve(remediationServiceToken);
  await remediation.saveAiSettings(
    {
      enabled: true,
      agentId: null,
      actorUserId: null,
      actorName: null,
      language: 'zh-CN',
    },
    null,
  );
  const outcome = await monitoring.recordResult(
    monitor.id,
    {
      status: 'down',
      latencyMs: null,
      httpStatus: 503,
      error: 'HTTP 503',
      details: {},
    },
    new Date(),
  );
  expect(outcome?.openedIncident?.title).toBe('Checkout 不可用');

  const incidents = await monitoring.listIncidents({
    state: 'open',
    page: 1,
    pageSize: 10,
  });
  const opened = incidents.rows.find((row) => row.monitorId === monitor.id)!;
  expect(opened.title).toBe('Checkout 不可用');
  const assembly = await app.container
    .resolve(databaseManagerToken)
    .transaction((conn) =>
      (
        app.container.resolve(incidentAgentsToken) as unknown as {
          assemble(
            conn: DatabaseConnection,
            id: string,
            cli: string,
          ): Promise<SubjectAssembly>;
        }
      ).assemble(conn, opened.id, 'nocomonitor'),
    );
  expect(assembly.guidance?.rules?.join('\n')).toContain(
    'Simplified Chinese (简体中文)',
  );
});

test('briefing and investigation steps require sign-in and monitoring read', async ({
  testApp,
  app,
}) => {
  expect((await testApp.request('/monitoringAi/briefing')).status).toBe(401);
  expect((await testApp.request('/incidents/1/aiActivity')).status).toBe(401);

  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const briefing = await admin.fetch('/monitoringAi/briefing?days=7');
  expect(briefing.status).toBe(200);
  const body = (await briefing.json()).data;
  expect(body.agent).toMatchObject({ configured: false, online: null });
  expect(body.stats).toHaveProperty('needsYou');
  expect((await admin.fetch('/incidents/missing/aiActivity')).status).toBe(404);

  const { monitoring, monitor } = await setUp(app);
  const incident = await monitoring.openManualIncident({
    serviceId: monitor.serviceId,
    monitorId: monitor.id,
    title: 'API is down',
    severity: 'major',
    body: 'Down',
    publicVisible: false,
    actor: person,
  });
  const activity = await admin.fetch(`/incidents/${incident.id}/aiActivity`);
  expect(activity.status).toBe(200);
  expect((await activity.json()).data).toMatchObject({
    runId: null,
    status: 'none',
    steps: [],
  });

  // A signed-in user without the monitoring grant is refused.
  const created = await admin.fetch(
    '/users',
    json({
      name: 'nomonitor',
      username: 'nomonitor',
      email: 'nomonitor@example.test',
      password: 'Member-test-123!',
      roleScopes: { app: [] },
    }),
  );
  expect(created.status).toBe(201);
  const outsider = await signIn(testApp, {
    username: 'nomonitor',
    password: 'Member-test-123!',
  });
  expect((await outsider.fetch('/monitoringAi/briefing')).status).toBe(403);
  expect(
    (await outsider.fetch(`/incidents/${incident.id}/aiActivity`)).status,
  ).toBe(403);
});

test('the diagnose command takes the whole diagnosis from --content-file', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const document = await (await admin.fetch('/swagger')).json();
  const operation = Object.values(
    document.paths as Record<string, Record<string, { operationId?: string }>>,
  )
    .flatMap((methods) => Object.values(methods))
    .find(
      (candidate) =>
        candidate.operationId === 'nocomonitorAgentIncidentDiagnosis',
    ) as Record<string, unknown> | undefined;
  expect(operation).toBeDefined();
  expect(JSON.stringify(operation?.['x-cli'])).toContain('content-file');
});

test('a recovery is written in the chosen language too', async ({ app }) => {
  const { monitoring, monitor } = await setUp(app, 'Billing');
  await app.container.resolve(remediationServiceToken).saveAiSettings(
    {
      enabled: true,
      agentId: null,
      actorUserId: null,
      actorName: null,
      language: 'zh-CN',
    },
    null,
  );
  const down = { latencyMs: null, httpStatus: 503, error: 'HTTP 503' };
  const opened = await monitoring.recordResult(
    monitor.id,
    { status: 'down', ...down, details: {} },
    new Date(),
  );
  const resolved = await monitoring.recordResult(
    monitor.id,
    { status: 'up', latencyMs: 120, httpStatus: 200, error: null, details: {} },
    new Date(),
  );
  expect(resolved?.resolvedIncident?.id).toBe(opened?.openedIncident?.id);
  const updates = await monitoring.listIncidentUpdates(
    opened!.openedIncident!.id,
  );
  expect(updates.map((update) => update.body)).toContain(
    '监控项连续 1 次检查成功，已恢复。',
  );
});

test('the agent’s verdict is recorded and reaches the incident', async ({
  app,
  testApp,
}) => {
  const { monitoring, monitor } = await setUp(app);
  const incident = await monitoring.openManualIncident({
    serviceId: monitor.serviceId,
    monitorId: monitor.id,
    title: 'API is down',
    severity: 'major',
    body: 'Down',
    publicVisible: false,
    actor: person,
  });
  await monitoring.recordDiagnosis(incident.id, {
    summary: 'The path does not exist; the monitor points at the wrong URL.',
    rootCause: '- Every check returns 404 from the application router',
    confidence: 'high',
    verdict: 'falseAlarm',
    suggestedActions: [],
    actor: agent,
  });
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const detail = await admin.fetch(`/incidents/${incident.id}`);
  expect(detail.status).toBe(200);
  expect((await detail.json()).data.incident).toMatchObject({
    aiVerdict: 'falseAlarm',
    aiConfidence: 'high',
  });
  // The timeline entry carries no English labels of its own.
  const updates = await monitoring.listIncidentUpdates(incident.id);
  const diagnosis = updates.find((update) => update.kind === 'diagnosis')!;
  expect(diagnosis.body).not.toMatch(/Root cause:|Confidence:/u);
});

test('a public status page counts blips instead of listing them', async ({
  app,
  testApp,
}) => {
  const { monitoring, service, monitor } = await setUp(app, 'Blip');
  const fail = {
    status: 'down' as const,
    latencyMs: null,
    httpStatus: 503,
    error: 'HTTP 503',
    details: {},
  };
  const pass = {
    status: 'up' as const,
    latencyMs: 100,
    httpStatus: 200,
    error: null,
    details: {},
  };
  // The probes resolve an incident when the recovering check is recorded, so both stories end now.
  // Down for an hour and a half: an incident visitors read about.
  const long = new Date(Date.now() - 90 * 60_000);
  await monitoring.recordResult(monitor.id, fail, long);
  await monitoring.recordResult(monitor.id, pass, new Date());
  // Down for two minutes, then back: a blip.
  await monitoring.recordResult(
    monitor.id,
    fail,
    new Date(Date.now() - 2 * 60_000),
  );
  await monitoring.recordResult(monitor.id, pass, new Date());
  await monitoring.createStatusPage({
    slug: 'blips',
    title: 'Status',
    description: null,
    serviceIds: [service.id],
    published: true,
  });

  const response = await testApp.request('/publicStatusPages/blips');
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data.blips).toBe(1);
  expect(data.blipMinutes).toBe(10);
  expect(data.incidents).toHaveLength(1);
  expect(new Date(data.incidents[0].startedAt).getTime()).toBe(long.getTime());
});
