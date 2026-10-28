// @vitest-environment node
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { databaseManagerToken } from '@nocobase/db';

import { readBriefing } from '../../server/monitoring/briefing.js';
import type { Actor } from '../../server/monitoring/types.js';
import {
  alertServiceToken,
  drillServiceToken,
  monitoringServiceToken,
  remediationServiceToken,
} from '../../server/providers/monitoring.js';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'test-auth-secret-at-least-32-characters' },
    notification: { channels: { inbox: { type: 'in-app' } } },
  },
});

const agent: Actor = { type: 'agent', id: 'agent-1', name: 'Diagnoser' };
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', origin: 'http://localhost' },
  body: JSON.stringify(body),
});
/** Monitoring listeners run after the write that announced the event. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
const down = {
  status: 'down' as const,
  latencyMs: null,
  httpStatus: 503,
  error: 'HTTP 503',
  details: {},
};
const up = {
  status: 'up' as const,
  latencyMs: 12,
  httpStatus: 200,
  error: null,
  details: {},
};

test('a drill fails on purpose, recovers through its fix, stays out of statistics and leaves nothing behind', async ({
  testApp,
  app,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const started = await admin.fetch('/monitoringDrill', json({}));
  expect(started.status).toBe(200);
  const status = (await started.json()).data;
  expect(status).toMatchObject({ state: 'running', completedOnce: false });
  expect(status.targetUrl).not.toContain(
    (await app.container.resolve(drillServiceToken).settings()).token,
  );

  const drill = app.container.resolve(drillServiceToken);
  const { token, monitorId, serviceId } = await drill.settings();
  // The target answers only to its token, and fails until recovered.
  expect(
    (await testApp.request(`/monitoringDrill/${token}/health`)).status,
  ).toBe(503);
  expect((await testApp.request('/monitoringDrill/wrong/health')).status).toBe(
    404,
  );
  expect(
    (
      await testApp.request('/monitoringDrill/wrong/recover', {
        method: 'POST',
      })
    ).status,
  ).toBe(404);

  // The service carries the fix and the runbook the agent works from.
  const monitoring = app.container.resolve(monitoringServiceToken);
  const service = (await monitoring.getService(serviceId!))!;
  expect(service.remediations?.map((action) => action.key)).toEqual([
    'recover',
  ]);
  expect(service.runbook).toContain('recover');
  expect(await monitoring.getMonitor(monitorId!)).toMatchObject({
    autoDiagnose: true,
    remediationLevel: 'approve',
    failureThreshold: 1,
  });

  const opened = await monitoring.recordResult(monitorId!, down, new Date());
  const incidentId = opened!.openedIncident!.id;
  // An agent asks for the fix; the drill's incident waits on people but counts in no statistic.
  const remediation = app.container.resolve(remediationServiceToken);
  const fix = await remediation.request({
    incidentId,
    actionKey: 'recover',
    reason: 'The drill target answers 503.',
    actor: agent,
  });
  const briefing = await readBriefing(
    app.container.resolve(databaseManagerToken),
    {
      days: 7,
      excludeServiceId: serviceId,
    },
  );
  expect(briefing.stats).toMatchObject({ incidents: 0, fixesRequested: 0 });
  expect(briefing.feed).toEqual([]);
  expect(briefing.needsYou.map((item) => item.incidentId)).toContain(
    incidentId,
  );

  // Recovering is what the approved fix calls; the probes then resolve the incident.
  expect(
    (
      await testApp.request(`/monitoringDrill/${token}/recover`, {
        method: 'POST',
      })
    ).status,
  ).toBe(200);
  expect(
    (await testApp.request(`/monitoringDrill/${token}/health`)).status,
  ).toBe(200);
  await remediation.reject(fix.id, { type: 'user', id: null, name: 'Ops' });
  await monitoring.recordResult(monitorId!, up, new Date());
  await settle();
  const recovered = (await (await admin.fetch('/monitoringDrill')).json()).data;
  expect(recovered).toMatchObject({
    state: 'recovered',
    incidentId,
    completedOnce: true,
  });
  expect(recovered.detectedAt).not.toBeNull();
  expect(recovered.recoveredAt).not.toBeNull();

  const ended = await admin.fetch('/monitoringDrill', {
    method: 'DELETE',
    headers: { origin: 'http://localhost' },
  });
  expect((await ended.json()).data).toMatchObject({
    state: 'idle',
    completedOnce: true,
  });
  expect(await monitoring.getService(serviceId!)).toBeNull();
  expect(await monitoring.getMonitor(monitorId!)).toBeNull();
  expect(await monitoring.getIncident(incidentId)).toBeNull();
  expect(await remediation.listForIncident(incidentId)).toEqual([]);
  expect(
    (await testApp.request(`/monitoringDrill/${token}/health`)).status,
  ).toBe(404);
});

test('alerts reach the chosen people once per event, only for the events switched on', async ({
  testApp,
  app,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const initial = (
    await (await admin.fetch('/monitoringAlerts/settings')).json()
  ).data;
  expect(initial).toMatchObject({
    recipients: [],
    channels: ['inbox'],
    events: { incidentOpened: true, incidentResolved: false },
    available: [{ name: 'inbox', type: 'in-app', kind: 'inApp' }],
  });

  const people = (
    await (await admin.fetch('/monitoringAlerts/recipients?q=')).json()
  ).data as { id: string }[];
  expect(people.length).toBeGreaterThan(0);
  const me = people[0];
  const saved = await admin.fetch(
    '/monitoringAlerts/settings',
    json(
      {
        recipients: [me.id],
        channels: ['inbox'],
        events: { ...initial.events, diagnosisFailed: false },
      },
      'PUT',
    ),
  );
  expect(saved.status).toBe(200);
  expect((await saved.json()).data.recipients).toMatchObject([{ id: me.id }]);
  expect(
    (
      await admin.fetch(
        '/monitoringAlerts/settings',
        json(
          {
            ...initial,
            recipients: [],
            channels: ['nowhere'],
            available: undefined,
          },
          'PUT',
        ),
      )
    ).status,
  ).toBe(400);

  const monitoring = app.container.resolve(monitoringServiceToken);
  const service = await monitoring.createService({
    name: 'Checkout',
    slug: 'checkout-alerts',
    description: null,
    groupName: null,
    repoUrl: null,
    runbook: null,
    remediations: [],
    sortOrder: 0,
  });
  const incident = await monitoring.openManualIncident({
    serviceId: service.id,
    monitorId: null,
    title: 'Checkout is down',
    severity: 'major',
    body: 'Down',
    publicVisible: false,
    actor: { type: 'user', id: null, name: 'Ops' },
  });
  await monitoring.setAiState(incident.id, { aiState: 'failed' });
  await settle();
  // The same event again sends nothing new.
  await app.container
    .resolve(alertServiceToken)
    .handle({ type: 'incident.opened', incident, monitor: null });

  const deliveries = (
    await (await admin.fetch('/monitoringAlerts/deliveries')).json()
  ).data as {
    event: string;
    incidentId: string;
    title: string;
    channels: { name: string }[];
  }[];
  expect(deliveries.map((item) => item.event)).toEqual(['incidentOpened']);
  expect(deliveries[0]).toMatchObject({
    incidentId: incident.id,
    title: 'Incident: Checkout is down',
  });

  // Switched on, a resolved incident says how long it lasted, in the admin's inbox.
  await admin.fetch(
    '/monitoringAlerts/settings',
    json(
      {
        recipients: [me.id],
        channels: ['inbox'],
        events: { ...initial.events, incidentResolved: true },
      },
      'PUT',
    ),
  );
  await app.container.resolve(alertServiceToken).handle({
    type: 'incident.resolved',
    incident: {
      ...incident,
      status: 'resolved',
      resolvedAt: new Date(new Date(incident.startedAt).getTime() + 5 * 60_000),
    },
  } as never);
  await settle();
  const inbox = (
    await (await admin.fetch('/notificationInApp/messages')).json()
  ).data as { title: string; body: string }[];
  expect(inbox).toContainEqual(
    expect.objectContaining({
      title: 'Recovered: Checkout is down',
      body: expect.stringContaining('5 min after the incident opened'),
    }),
  );

  // An alert whose incident is gone keeps its title but no longer links to it.
  await app.container
    .resolve(databaseManagerToken)
    .query()
    .deleteFrom('mnIncidents')
    .where('id', '=', incident.id)
    .execute();
  expect(
    (await (await admin.fetch('/monitoringAlerts/deliveries')).json()).data[0],
  ).toMatchObject({ title: 'Recovered: Checkout is down', incidentId: null });

  const tested = await admin.fetch('/monitoringAlerts/test', json({}));
  expect(tested.status).toBe(200);
  expect((await tested.json()).data).toMatchObject({ event: 'test' });
});

test('drill and alerts require sign-in and the monitoring grant', async ({
  testApp,
}) => {
  for (const path of [
    '/monitoringDrill',
    '/monitoringAlerts/settings',
    '/monitoringAlerts/deliveries',
    '/monitoringAlerts/recipients',
  ])
    expect((await testApp.request(path)).status).toBe(401);

  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
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
  expect((await outsider.fetch('/monitoringDrill')).status).toBe(403);
  expect((await outsider.fetch('/monitoringDrill', json({}))).status).toBe(403);
  expect((await outsider.fetch('/monitoringAlerts/settings')).status).toBe(403);
  expect((await outsider.fetch('/monitoringAlerts/recipients')).status).toBe(
    403,
  );
  expect(
    (await outsider.fetch('/monitoringAlerts/test', json({}))).status,
  ).toBe(403);
});
