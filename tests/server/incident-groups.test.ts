// @vitest-environment node
// Incidents opened together — the same service, or monitors of one host, within minutes — form one group: the incident
// opened first leads it, carries the diagnosis and the alerts, and resolving it resolves the rest.
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import type { SubjectAssembly } from '@nocobase/app-plugin-agents/server/tokens';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';

import { readBriefing } from '../../server/monitoring/briefing.js';
import { GROUP_WINDOW_MS } from '../../server/monitoring/service.js';
import type { Actor, ProbeResult } from '../../server/monitoring/types.js';
import { incidentAgentsToken } from '../../server/providers/agents.js';
import { monitoringServiceToken } from '../../server/providers/monitoring.js';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'test-auth-secret-at-least-32-characters' },
    notification: { channels: { inbox: { type: 'in-app' } } },
  },
});

type TestApp = Parameters<Parameters<typeof test>[1]>[0]['app'];

const person: Actor = { type: 'user', id: 'user-1', name: 'Ops' };
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json', origin: 'http://localhost' },
  body: JSON.stringify(body),
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
const fail: ProbeResult = {
  status: 'down',
  latencyMs: null,
  httpStatus: 404,
  error: 'HTTP 404',
  details: {},
};

/** A service with one disabled monitor of `url`, so the probe loop never reaches it. */
async function monitorOf(app: TestApp, name: string, url: string) {
  const monitoring = app.container.resolve(monitoringServiceToken);
  const service = await monitoring.createService({
    name,
    slug: `service-${monitoring.newId()}`,
    description: null,
    groupName: null,
    repoUrl: null,
    runbook: null,
    remediations: [],
    sortOrder: 0,
  });
  return monitoring.createMonitor({
    serviceId: service.id,
    name: `${name} health`,
    type: 'http',
    region: null,
    url,
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
    remediationLevel: 'off',
    sortOrder: 0,
  });
}

async function openFor(app: TestApp, monitorId: string, at = new Date()) {
  const outcome = await app.container
    .resolve(monitoringServiceToken)
    .recordResult(monitorId, fail, at);
  return outcome!.openedIncident!;
}

test('monitors of one host failing together share one incident group', async ({
  app,
  testApp,
}) => {
  const monitoring = app.container.resolve(monitoringServiceToken);
  const crm = await monitorOf(app, 'CRM', 'https://apps.example.test/crm');
  const itam = await monitorOf(app, 'ITAM', 'https://apps.example.test/itam');
  const other = await monitorOf(app, 'Docs', 'https://docs.example.test/');
  const late = await monitorOf(app, 'Reach', 'https://apps.example.test/reach');

  const lead = await openFor(app, crm.id);
  const joined = await openFor(app, itam.id);
  const alone = await openFor(app, other.id);
  // Past the window, the same host starts a group of its own.
  const separate = await openFor(
    app,
    late.id,
    new Date(Date.now() + GROUP_WINDOW_MS + 60_000),
  );
  expect(lead.groupId).toBeNull();
  expect(joined.groupId).toBe(lead.id);
  expect(alone.groupId).toBeNull();
  expect(separate.groupId).toBeNull();

  // The page of either shows the group.
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const leadPage = (await (await admin.fetch(`/incidents/${lead.id}`)).json())
    .data;
  expect(leadPage.group).toMatchObject({
    lead: null,
    members: [{ id: joined.id, monitorName: 'ITAM health' }],
  });
  const memberPage = (
    await (await admin.fetch(`/incidents/${joined.id}`)).json()
  ).data;
  expect(memberPage.group.lead).toMatchObject({ id: lead.id });

  // The agent diagnosing the lead is told about the incident that joined it.
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
      ).assemble(conn, lead.id, 'nocomonitor'),
    );
  expect(
    (assembly.data as { relatedFailures: unknown[] }).relatedFailures,
  ).toEqual([
    expect.objectContaining({
      monitor: expect.objectContaining({
        name: 'ITAM health',
        url: 'https://apps.example.test/itam',
      }),
    }),
  ]);
  expect(assembly.guidance?.rules?.join('\n')).toContain(
    'Treat them as one event',
  );

  // The briefing counts the group once.
  const briefing = await readBriefing(
    app.container.resolve(databaseManagerToken),
    { days: 7 },
  );
  expect(briefing.stats.incidents).toBe(3);

  // Resolving the lead resolves the incident that joined it.
  await monitoring.postIncidentUpdate(lead.id, {
    body: 'Fixed the router',
    status: 'resolved',
    publicVisible: false,
    actor: person,
  });
  expect((await monitoring.getIncident(joined.id))?.status).toBe('resolved');
  expect((await monitoring.getIncident(alone.id))?.status).not.toBe('resolved');
});

test('a group sends one alert and shows as one incident on a status page', async ({
  app,
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const initial = (
    await (await admin.fetch('/monitoringAlerts/settings')).json()
  ).data;
  const [me] = (
    await (await admin.fetch('/monitoringAlerts/recipients?q=')).json()
  ).data as { id: string }[];
  await admin.fetch(
    '/monitoringAlerts/settings',
    json(
      { recipients: [me.id], channels: ['inbox'], events: initial.events },
      'PUT',
    ),
  );

  const monitoring = app.container.resolve(monitoringServiceToken);
  const web = await monitorOf(app, 'Web', 'https://shop.example.test/');
  const api = await monitorOf(app, 'API', 'https://shop.example.test/api');
  const lead = await openFor(app, web.id, new Date(Date.now() - 30 * 60_000));
  const joined = await openFor(app, api.id, new Date(Date.now() - 29 * 60_000));
  expect(joined.groupId).toBe(lead.id);
  await settle();

  const deliveries = (
    await (await admin.fetch('/monitoringAlerts/deliveries')).json()
  ).data as { event: string; incidentId: string }[];
  expect(deliveries.map((item) => item.incidentId)).toEqual([lead.id]);

  await monitoring.createStatusPage({
    slug: 'shop',
    title: 'Shop',
    description: null,
    serviceIds: [web.serviceId, api.serviceId],
    published: true,
  });
  const page = (await (await testApp.request('/publicStatusPages/shop')).json())
    .data;
  expect(page.incidents).toEqual([
    expect.objectContaining({ id: lead.id, affected: 2 }),
  ]);
});
