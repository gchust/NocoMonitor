// Setting up with the agent: the dialog people describe what they want in, and the conversation page with the agent at
// work, its questions and its proposal. The real pages render with application hooks; the API answers here.
import { apiClientToken } from '@nocobase/app-client';
import {
  AuthenticationProvider,
  authenticationClientToken,
} from '@nocobase/app-plugin-authentication/client';
import {
  AuthorizationClient,
  authorizationClientToken,
  type AuthorizationSnapshot,
} from '@nocobase/app-plugin-authorization/client';
import {
  answerApi,
  renderWithApp,
  type ApiCall,
} from '@nocobase/app-testing/client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import packageMetadata from '../../package.json' with { type: 'json' };
import enUS from '../../client/locales/en-US.js';
import type {
  Setup,
  SetupActivity,
  SetupProposal,
} from '../../client/lib/monitoring.js';
import { AskAiButton } from '../../client/pages/setup/ask-ai-dialog.js';
import SetupPage from '../../client/pages/setup/index.js';

const copy = enUS.monitoring.setup;
const getSession = vi.fn(async () => ({ data: null }));
let permissions: AuthorizationSnapshot;
let setup: Setup;
let startAnswer: () => unknown;

const manage: AuthorizationSnapshot = {
  unrestricted: false,
  permissions: [
    {
      resource: { type: 'settings', id: 'monitoring' },
      actions: ['read', 'manage'],
    },
  ],
};
const readOnly: AuthorizationSnapshot = {
  unrestricted: false,
  permissions: [
    { resource: { type: 'settings', id: 'monitoring' }, actions: ['read'] },
  ],
};

const activity: SetupActivity = {
  runId: 'run-1',
  status: 'running',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  model: 'model',
  steps: [
    {
      seq: 1,
      at: new Date().toISOString(),
      kind: 'request',
      targets: ['shop.example.test'],
      more: 0,
    },
    {
      seq: 4,
      at: new Date().toISOString(),
      kind: 'probe',
      targets: [],
      more: 0,
    },
  ],
};

const proposal: SetupProposal = {
  services: [
    {
      key: 'shop',
      existingId: 'svc-1',
      name: 'Shop',
      description: null,
      repoUrl: null,
    },
    {
      key: 'api',
      existingId: null,
      name: 'Shop API',
      description: null,
      repoUrl: null,
    },
  ],
  monitors: [
    {
      service: 'shop',
      name: 'Shop home',
      type: 'keyword',
      url: 'https://shop.example.test/',
      method: 'GET',
      expectedStatus: '200-299',
      keyword: 'Shop',
      jsonPath: null,
      jsonExpected: null,
      intervalSec: 60,
      timeoutMs: 10000,
      degradedLatencyMs: null,
      autoDiagnose: true,
      note: 'The page title is Shop.',
    },
    {
      service: 'api',
      name: 'API health',
      type: 'json',
      url: 'https://api.example.test/health',
      method: 'GET',
      expectedStatus: '200-299',
      keyword: null,
      jsonPath: 'status',
      jsonExpected: 'ok',
      intervalSec: 60,
      timeoutMs: 10000,
      degradedLatencyMs: null,
      autoDiagnose: true,
      note: null,
    },
  ],
  statusPage: {
    title: 'Shop status',
    slug: 'shop',
    description: null,
    services: ['shop', 'api'],
  },
};

function conversation(overrides: Partial<Setup> = {}): Setup {
  return {
    id: 'setup-1',
    kind: 'monitors',
    state: 'replied',
    runId: 'run-1',
    turns: [
      {
        id: 't1',
        role: 'user',
        at: '2026-10-28T10:00:00Z',
        text: 'Monitor the shop',
        questions: [],
        proposal: null,
        runId: 'run-1',
      },
    ],
    result: null,
    createdByName: 'Ops',
    createdAt: '2026-10-28T10:00:00Z',
    appliedAt: null,
    ...overrides,
  };
}

const agentTurn = (extra: Partial<Setup['turns'][number]>) => ({
  id: 't2',
  role: 'agent' as const,
  at: '2026-10-28T10:00:30Z',
  text: 'Both answer.',
  questions: [],
  proposal: null,
  runId: 'run-1',
  ...extra,
});

const api = vi.fn(({ method, path }: ApiCall) => {
  if (method === 'GET' && path === 'authorization/permissions')
    return { data: permissions };
  if (method === 'POST' && path === 'monitoringSetups') return startAnswer();
  if (method === 'GET' && path === 'monitoringSetups/setup-1')
    return { data: setup };
  if (method === 'GET' && path === 'monitoringSetups/setup-1/activity')
    return { data: activity };
  if (method === 'POST' && path === 'monitoringSetups/setup-1/messages') {
    setup = { ...setup, state: 'queued' };
    return { data: setup };
  }
  if (method === 'POST' && path === 'monitoringSetups/setup-1/apply') {
    setup = {
      ...setup,
      state: 'applied',
      result: {
        serviceIds: ['svc-2'],
        monitorIds: ['mon-2'],
        statusPageId: 'page-1',
        chosen: { monitors: [1], statusPage: true },
      },
    };
    return { data: setup };
  }
  return new Response(null, { status: 404 });
});

const bodyOf = (path: string) =>
  api.mock.calls.find(
    ([call]) => call.method === 'POST' && call.path === path,
  )?.[0].json;

async function renderAt(route: string) {
  return renderWithApp(
    <AuthenticationProvider>
      <Routes>
        <Route path='/monitors' element={<AskAiButton kind='monitors' />} />
        <Route path='/setup/:setupId' element={<SetupPage />} />
      </Routes>
    </AuthenticationProvider>,
    {
      route,
      namespace: packageMetadata.name,
      namespaces: { [packageMetadata.name]: enUS },
      fetch: answerApi(api),
      services: (app) => {
        app.container.instance(authenticationClientToken, { getSession });
        app.container.singleton(
          authorizationClientToken,
          (resolver) =>
            new AuthorizationClient(resolver.resolve(apiClientToken)),
        );
      },
    },
  );
}

beforeEach(() => {
  api.mockClear();
  permissions = manage;
  setup = conversation();
  startAnswer = () => ({ data: setup });
});

describe('asking the agent', () => {
  it('starts a conversation from what the person writes and opens it', async () => {
    setup = conversation({ state: 'running' });
    await renderAt('/monitors');
    await userEvent.click(
      screen.getByRole('button', { name: copy.ask.monitors.button }),
    );
    const dialog = await screen.findByRole('dialog');
    // An example fills the request in.
    await userEvent.click(
      within(dialog).getByRole('button', {
        name: copy.ask.monitors.examples[0],
      }),
    );
    expect(within(dialog).getByRole('textbox')).toHaveValue(
      copy.ask.monitors.examples[0],
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.ask.submit }),
    );

    expect(await screen.findByText(copy.live)).toBeVisible();
    expect(bodyOf('monitoringSetups')).toEqual({
      kind: 'monitors',
      text: copy.ask.monitors.examples[0],
      language: 'en-US',
    });
    // The agent's steps, live, in the words of setting up.
    expect(await screen.findByText(copy.now.probe)).toBeVisible();
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((item) => item.textContent)).toContain(
      `${copy.step.request}shop.example.test`,
    );
    // A draft can be written meanwhile; it is sent once the agent answered.
    expect(
      screen.getByRole('button', { name: copy.composer.send }),
    ).toBeDisabled();
  });

  it('points to AI settings when no agent is chosen', async () => {
    startAnswer = () =>
      Response.json(
        {
          error: {
            code: 400,
            status: 'FAILED_PRECONDITION',
            reason: 'AI_NOT_CONFIGURED',
            domain: 'nocomonitor',
            message: 'Choose an agent',
          },
        },
        { status: 400 },
      );
    await renderAt('/monitors');
    await userEvent.click(
      screen.getByRole('button', { name: copy.ask.monitors.button }),
    );
    await userEvent.type(await screen.findByRole('textbox'), 'Monitor it');
    await userEvent.click(
      screen.getByRole('button', { name: copy.ask.submit }),
    );
    expect(
      await screen.findByRole('link', { name: copy.errors.openAiSettings }),
    ).toHaveAttribute('href', '/ai');
  });
});

describe('the conversation', () => {
  it('answers a single question with one of its options at once', async () => {
    setup = conversation({
      turns: [
        ...conversation().turns,
        agentTurn({
          text: 'Which shop?',
          questions: [
            {
              id: 'q1',
              text: 'Which address?',
              options: ['shop.example.test'],
            },
          ],
        }),
      ],
    });
    await renderAt('/setup/setup-1');
    await userEvent.click(
      await screen.findByRole('button', { name: 'shop.example.test' }),
    );
    await waitFor(() =>
      expect(bodyOf('monitoringSetups/setup-1/messages')).toEqual({
        text: 'Which address?\n→ shop.example.test',
      }),
    );
  });

  it('creates the monitors the person keeps, then says what was created', async () => {
    setup = conversation({
      turns: [...conversation().turns, agentTurn({ proposal })],
    });
    await renderAt('/setup/setup-1');
    const card = await screen.findByRole('region', {
      name: copy.proposal.title,
    });
    expect(within(card).getByText(copy.proposal.existingService)).toBeVisible();
    expect(within(card).getByText(copy.proposal.newService)).toBeVisible();
    expect(within(card).getByText('Page contains “Shop”')).toBeVisible();
    expect(within(card).getByText('status = ok')).toBeVisible();
    expect(within(card).getByText('The page title is Shop.')).toBeVisible();

    await userEvent.click(
      within(card).getByRole('checkbox', { name: 'Shop home' }),
    );
    await userEvent.click(
      within(card).getByRole('button', { name: 'Create 2 selected' }),
    );
    await waitFor(() =>
      expect(bodyOf('monitoringSetups/setup-1/apply')).toEqual({
        monitors: [1],
        statusPage: true,
      }),
    );
    expect(await screen.findByText(copy.applied.title)).toBeVisible();
    // Only what was created stays listed.
    const created = screen.getByRole('region', { name: copy.proposal.title });
    expect(within(created).queryByText('Shop home')).toBeNull();
    expect(within(created).getByText('API health')).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: copy.composer.label }),
    ).toBeNull();
  });

  it('folds a proposal the conversation moved on from', async () => {
    setup = conversation({
      turns: [
        ...conversation().turns,
        agentTurn({ proposal }),
        {
          ...conversation().turns[0],
          id: 't3',
          text: 'Leave out the page',
        },
        agentTurn({ id: 't4', proposal: { ...proposal, statusPage: null } }),
      ],
    });
    await renderAt('/setup/setup-1');
    expect(
      await screen.findByText(
        'An earlier proposal: 2 monitors (replaced), Shop status',
      ),
    ).toBeVisible();
    expect(
      screen.getAllByRole('region', { name: copy.proposal.title }),
    ).toHaveLength(1);
  });

  it('lets a reader without manage follow but not act', async () => {
    permissions = readOnly;
    setup = conversation({
      turns: [...conversation().turns, agentTurn({ proposal })],
    });
    await renderAt('/setup/setup-1');
    expect(
      await screen.findByRole('region', { name: copy.proposal.title }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
    expect(
      screen.queryByRole('textbox', { name: copy.composer.label }),
    ).toBeNull();
  });
});
