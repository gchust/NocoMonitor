// @vitest-environment node
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { databaseManagerToken } from '@nocobase/db';

import { RemediationService } from '../../server/monitoring/remediation.js';
import type { Actor, RemediationLevel } from '../../server/monitoring/types.js';
import { monitoringServiceToken } from '../../server/providers/monitoring.js';
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
const silent = { info() {}, warn() {}, error() {} };

/** A service with one fix, a disabled monitor at `level`, an open incident, and a fix endpoint answering `status`. */
async function setUp(
  app: Parameters<Parameters<typeof test>[1]>[0]['app'],
  level: RemediationLevel,
  status = 200,
) {
  const monitoring = app.container.resolve(monitoringServiceToken);
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchStub = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response('done', { status });
  }) as typeof fetch;
  const remediation = new RemediationService(
    app.container.resolve(databaseManagerToken),
    monitoring,
    silent,
    fetchStub,
  );
  const service = await monitoring.createService({
    name: `Service ${level}`,
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
        headers: { Authorization: 'Bearer secret' },
        body: null,
      },
    ],
    sortOrder: 0,
  });
  const monitor = await monitoring.createMonitor({
    serviceId: service.id,
    name: 'API',
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
    failureThreshold: 2,
    recoveryThreshold: 2,
    // Disabled, so the probe loop never reaches the made-up URL during the test.
    enabled: false,
    autoDiagnose: false,
    remediationLevel: level,
    sortOrder: 0,
  });
  const incident = await monitoring.openManualIncident({
    serviceId: service.id,
    monitorId: monitor.id,
    title: 'API is down',
    severity: 'major',
    body: 'Down',
    publicVisible: false,
    actor: person,
  });
  return { monitoring, remediation, monitor, incident, calls };
}

test('an agent cannot fix anything when the monitor is off or suggest-only', async ({
  app,
}) => {
  for (const level of ['off', 'suggest'] as const) {
    const { remediation, incident, calls } = await setUp(app, level);
    await expect(
      remediation.request({
        incidentId: incident.id,
        actionKey: 'restart',
        reason: 'r',
        actor: agent,
      }),
    ).rejects.toMatchObject({
      reason: level === 'off' ? 'REMEDIATION_OFF' : 'REMEDIATION_SUGGEST_ONLY',
    });
    expect(calls).toHaveLength(0);
    expect(await remediation.listForIncident(incident.id)).toHaveLength(0);
  }
});

test('only actions the service defines can be requested', async ({ app }) => {
  const { remediation, incident, calls } = await setUp(app, 'auto');
  await expect(
    remediation.request({
      incidentId: incident.id,
      actionKey: 'rm-rf',
      reason: 'r',
      actor: agent,
    }),
  ).rejects.toMatchObject({ reason: 'ACTION_UNKNOWN' });
  expect(calls).toHaveLength(0);
});

test('at approve, an agent’s request waits for a person, and only one fix is active at a time', async ({
  app,
}) => {
  const { remediation, monitoring, incident, calls } = await setUp(
    app,
    'approve',
  );
  const pending = await remediation.request({
    incidentId: incident.id,
    actionKey: 'restart',
    reason: 'All regions 502',
    actor: agent,
  });
  expect(pending).toMatchObject({
    status: 'pending',
    requestedByType: 'agent',
  });
  expect(calls).toHaveLength(0);
  await expect(
    remediation.request({
      incidentId: incident.id,
      actionKey: 'restart',
      reason: 'again',
      actor: person,
    }),
  ).rejects.toMatchObject({ reason: 'REMEDIATION_IN_PROGRESS' });

  const applied = await remediation.approve(pending.id, person);
  expect(applied).toMatchObject({
    status: 'verifying',
    httpStatus: 200,
    decidedByName: 'Ops',
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    url: 'https://deploy.example.test/restart',
    init: { method: 'POST', headers: { Authorization: 'Bearer secret' } },
  });
  expect((await monitoring.getIncident(incident.id))?.status).toBe(
    'monitoring',
  );
  await expect(remediation.approve(pending.id, person)).rejects.toMatchObject({
    reason: 'NOT_PENDING',
  });
});

test('a rejected request never runs', async ({ app }) => {
  const { remediation, incident, calls } = await setUp(app, 'approve');
  const pending = await remediation.request({
    incidentId: incident.id,
    actionKey: 'restart',
    reason: 'r',
    actor: agent,
  });
  expect(await remediation.reject(pending.id, person, 'Not now')).toMatchObject(
    { status: 'rejected', decidedByName: 'Ops' },
  );
  expect(calls).toHaveLength(0);
});

test('at auto, an agent’s fix runs at once; a failing call is recorded as failed', async ({
  app,
}) => {
  const ok = await setUp(app, 'auto');
  expect(
    await ok.remediation.request({
      incidentId: ok.incident.id,
      actionKey: 'restart',
      reason: 'r',
      actor: agent,
    }),
  ).toMatchObject({ status: 'verifying', decidedByName: 'auto' });

  const broken = await setUp(app, 'auto', 500);
  expect(
    await broken.remediation.request({
      incidentId: broken.incident.id,
      actionKey: 'restart',
      reason: 'r',
      actor: agent,
    }),
  ).toMatchObject({ status: 'failed', httpStatus: 500 });
});

test('a person with Manage runs a fix directly even when agents may not', async ({
  app,
}) => {
  const { remediation, incident, calls } = await setUp(app, 'off');
  expect(
    await remediation.request({
      incidentId: incident.id,
      actionKey: 'restart',
      reason: 'r',
      actor: person,
    }),
  ).toMatchObject({ status: 'verifying', requestedByType: 'user' });
  expect(calls).toHaveLength(1);
});

test('the probes decide: a fix that did not help escalates the incident', async ({
  app,
}) => {
  const { remediation, monitoring, incident } = await setUp(app, 'auto');
  const applied = await remediation.request({
    incidentId: incident.id,
    actionKey: 'restart',
    reason: 'r',
    actor: agent,
  });
  expect(applied.verifyAt).not.toBeNull();
  // Not due yet: nothing is settled.
  expect(await remediation.verifyDue(new Date())).toBe(0);
  // The monitor is still not up when the window passes.
  const later = new Date(Date.now() + 60 * 60_000);
  // Earlier tests share the database, so their fixes may come due too.
  expect(await remediation.verifyDue(later)).toBeGreaterThanOrEqual(1);
  expect((await remediation.listForIncident(incident.id))[0]?.status).toBe(
    'unverified',
  );
  expect((await monitoring.getIncident(incident.id))?.status).toBe(
    'investigating',
  );
});

test('resolving the incident verifies the fix being watched', async ({
  app,
}) => {
  const { remediation, monitoring, incident } = await setUp(app, 'auto');
  await remediation.request({
    incidentId: incident.id,
    actionKey: 'restart',
    reason: 'r',
    actor: agent,
  });
  await monitoring.postIncidentUpdate(incident.id, {
    body: 'Recovered',
    status: 'resolved',
    publicVisible: false,
    actor: person,
  });
  await remediation.settleResolved(incident.id);
  expect((await remediation.listForIncident(incident.id))[0]?.status).toBe(
    'verified',
  );
});

test('AI and fix endpoints require sign-in, and service fix headers come back masked', async ({
  testApp,
}) => {
  for (const path of [
    '/monitoringAi/settings',
    '/incidents/1/remediations',
    '/monitorAgent/incident/context',
  ])
    expect((await testApp.request(path)).status).toBe(401);

  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const json = (body: unknown, method = 'POST') => ({
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  });
  const created = await admin.fetch(
    '/services',
    json({
      name: 'Masked',
      slug: 'masked',
      remediations: [
        {
          key: 'restart',
          title: 'Restart',
          method: 'POST',
          url: 'https://deploy.example.test/restart',
          headers: { Authorization: 'Bearer secret' },
        },
      ],
    }),
  );
  expect(created.status).toBe(201);
  const service = (await created.json()).data;
  expect(service.remediations[0].headers.Authorization).not.toContain('secret');
  // Saving the masked value back keeps the stored secret.
  const patched = await admin.fetch(
    `/services/${service.id}`,
    json({ remediations: service.remediations }, 'PATCH'),
  );
  expect(patched.status).toBe(200);
  // An agent's run token is the only way into the agent commands; a session is refused.
  expect((await admin.fetch('/monitorAgent/incident/context')).status).toBe(
    403,
  );
});
