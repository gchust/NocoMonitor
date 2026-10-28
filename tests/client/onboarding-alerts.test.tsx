// Getting started with its drill on the overview, and the alert settings page. The real pages render with application
// hooks; the API answers here.
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
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import packageMetadata from '../../package.json' with { type: 'json' };
import enUS from '../../client/locales/en-US.js';
import type {
  AiBriefing,
  AlertDelivery,
  AlertSettingsView,
  DrillStatus,
} from '../../client/lib/monitoring.js';
import AiSettingsPage from '../../client/pages/ai/index.js';
import AlertsPage from '../../client/pages/alerts/index.js';
import OverviewPage from '../../client/pages/overview/index.js';

const copy = enUS.monitoring;
const getSession = vi.fn(async () => ({ data: null }));
let permissions: AuthorizationSnapshot;
let drill: DrillStatus;
let settings: AlertSettingsView;
let deliveries: AlertDelivery[];

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

const idle: DrillStatus = {
  state: 'idle',
  serviceId: null,
  monitorId: null,
  incidentId: null,
  startedAt: null,
  detectedAt: null,
  aiState: null,
  diagnosedAt: null,
  fix: null,
  recoveredAt: null,
  targetUnreachable: false,
  targetUrl: null,
  completedOnce: false,
};

const briefing: AiBriefing = {
  since: '2026-10-20T00:00:00Z',
  agent: {
    configured: true,
    enabled: true,
    name: 'Claude · sonnet',
    tool: 'claude',
    model: 'sonnet',
    online: true,
    busy: 0,
  },
  stats: {
    incidents: 0,
    diagnosed: 0,
    medianTimeToDiagnosisMs: null,
    fixesRequested: 0,
    fixesVerified: 0,
    needsYou: 0,
  },
  needsYou: [],
  pendingFixes: [],
  feed: [],
};

const api = vi.fn(({ method, path, json }: ApiCall) => {
  if (method === 'GET' && path === 'authorization/permissions')
    return { data: permissions };
  if (method === 'GET' && path === 'statusOverview')
    return { data: { services: [], incidents: [] } };
  if (method === 'GET' && path === 'statusPages') return { data: [] };
  if (method === 'GET' && path === 'monitoringAi/briefing')
    return { data: briefing };
  if (method === 'GET' && path === 'monitoringDrill') return { data: drill };
  if (method === 'POST' && path === 'monitoringDrill') {
    drill = {
      ...idle,
      state: 'running',
      serviceId: 'svc-drill',
      startedAt: new Date().toISOString(),
    };
    return { data: drill };
  }
  if (method === 'GET' && path === 'monitoringAi/settings')
    return {
      data: {
        enabled: true,
        agentId: null,
        actorUserId: null,
        actorName: null,
        language: null,
      },
    };
  if (method === 'GET' && path === 'agents/available') return { data: [] };
  if (method === 'GET' && path === 'monitoringAlerts/settings')
    return { data: settings };
  if (method === 'PUT' && path === 'monitoringAlerts/settings') {
    const body = json as {
      recipients: string[];
      events: AlertSettingsView['events'];
    };
    settings = {
      ...settings,
      events: body.events,
      recipients: settings.recipients.filter((person) =>
        body.recipients.includes(person.id),
      ),
    };
    return { data: settings };
  }
  if (method === 'GET' && path === 'monitoringAlerts/deliveries')
    return { data: deliveries };
  if (method === 'GET' && path === 'monitoringAlerts/recipients')
    return { data: settings.recipients };
  return new Response(null, { status: 404 });
});

async function renderAt(route: string) {
  return renderWithApp(
    <AuthenticationProvider>
      <Routes>
        <Route path='/' element={<OverviewPage />} />
        <Route path='/alerts' element={<AlertsPage />} />
        <Route path='/ai' element={<AiSettingsPage />} />
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
  localStorage.clear();
  permissions = manage;
  drill = idle;
  settings = {
    recipients: [{ id: 'u1', name: 'Ada Ops', email: 'ada@example.test' }],
    channels: ['inbox'],
    events: {
      incidentOpened: true,
      fixAwaitingApproval: true,
      diagnosisFailed: true,
      fixNotRecovered: true,
      incidentResolved: false,
    },
    available: [
      { name: 'inbox', type: 'in-app', kind: 'inApp' },
      { name: 'legacy', type: 'sms', kind: 'unsupported' },
    ],
  };
  deliveries = [];
});

describe('getting started', () => {
  it('counts what the application already has and leads to the next step', async () => {
    await renderAt('/');
    expect(await screen.findByText(copy.start.title)).toBeVisible();
    expect(screen.getByText(/1 of 3 done/)).toBeVisible();
    // The agent is online, so adding a monitor is next and the page's primary action.
    expect(
      screen.getByRole('button', { name: copy.start.steps.monitor.action }),
    ).toHaveAttribute('href', '/monitors');
  });

  it('starts a drill only after confirmation, then follows it', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    await user.click(
      await screen.findByRole('button', {
        name: copy.start.steps.drill.action,
      }),
    );
    expect(
      await screen.findByRole('alertdialog', { name: copy.drill.confirmTitle }),
    ).toBeVisible();
    expect(api).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: 'monitoringDrill' }),
    );
    await user.click(screen.getByRole('button', { name: copy.drill.confirm }));
    expect(await screen.findByText(copy.drill.running)).toBeVisible();
    expect(screen.getByText(copy.drill.waitingCheck)).toBeVisible();
    expect(screen.getByRole('button', { name: copy.drill.end })).toBeVisible();

    // Hidden while it runs, the drill stays in a slim banner that leads back to the card.
    await user.click(screen.getByRole('button', { name: copy.start.hide }));
    expect(screen.queryByText(copy.start.title)).not.toBeInTheDocument();
    const show = screen.getByRole('button', { name: copy.drill.show });
    await waitFor(() => expect(show).toHaveFocus());
    await user.click(show);
    expect(
      await screen.findByRole('region', { name: copy.start.title }),
    ).toHaveFocus();
  });

  it('stays hidden once hidden, and is not offered to readers', async () => {
    const user = userEvent.setup();
    const view = await renderAt('/');
    await user.click(
      await screen.findByRole('button', { name: copy.start.hide }),
    );
    expect(screen.queryByText(copy.start.title)).not.toBeInTheDocument();
    // The button that brings it back takes the focus the Hide button had.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: copy.start.show }),
      ).toHaveFocus(),
    );
    view.unmount();

    localStorage.clear();
    permissions = readOnly;
    await renderAt('/');
    await screen.findByText(copy.overview.title);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'authorization/permissions' }),
      ),
    );
    expect(screen.queryByText(copy.start.title)).not.toBeInTheDocument();
  });
});

describe('drills after the first', () => {
  it('starts another drill from the AI page and follows it on the overview', async () => {
    const user = userEvent.setup();
    drill = { ...idle, completedOnce: true };
    await renderAt('/ai');
    await user.click(
      await screen.findByRole('button', {
        name: copy.start.steps.drill.action,
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: copy.drill.confirm }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST', path: 'monitoringDrill' }),
      ),
    );
    expect(await screen.findByText(copy.drill.running)).toBeVisible();
    expect(screen.getByRole('button', { name: copy.drill.end })).toBeVisible();
  });

  it('is not offered to readers', async () => {
    permissions = readOnly;
    await renderAt('/ai');
    await screen.findByText(copy.ai.settings.safetyTitle);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'authorization/permissions' }),
      ),
    );
    expect(
      screen.queryByText(copy.drill.practice.title),
    ).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'monitoringDrill' }),
    );
  });
});

describe('alert settings', () => {
  it('applies a switched event at once, and saves recipients with their own Save', async () => {
    const user = userEvent.setup();
    await renderAt('/alerts');
    // Permissions arrive after the settings; the form then offers saving.
    const save = await screen.findByRole('button', { name: copy.actions.save });
    // Unsupported channels are listed but cannot be chosen.
    expect(screen.getByRole('checkbox', { name: /legacy/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(save).toBeDisabled();
    expect(
      screen.getByRole('button', { name: copy.alerts.test }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole('switch', { name: copy.alerts.events.incidentResolved }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          path: 'monitoringAlerts/settings',
          json: expect.objectContaining({
            recipients: ['u1'],
            channels: ['inbox'],
            events: expect.objectContaining({ incidentResolved: true }),
          }),
        }),
      ),
    );
    expect(save).toBeDisabled();

    // The chip's remove button says whom it removes.
    await user.click(
      await screen.findByRole('button', { name: 'Remove Ada Ops' }),
    );
    expect(save).toBeEnabled();
    expect(
      screen.getByRole('button', { name: copy.alerts.test }),
    ).toBeDisabled();
    expect(screen.getByText(copy.alerts.testNeedsSave)).toBeVisible();
    expect(screen.getByText(copy.alerts.recipients.none)).toBeVisible();
    await user.click(save);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          json: expect.objectContaining({ recipients: [] }),
        }),
      ),
    );
  });

  it('lists recent deliveries with their incident', async () => {
    deliveries = [
      {
        key: 'k1',
        event: 'incidentOpened',
        incidentId: 'inc-1',
        title: 'Incident: API is down',
        at: '2026-10-27T10:00:00Z',
        status: 'delivered',
        channels: [{ name: 'inbox', status: 'delivered' }],
      },
    ];
    await renderAt('/alerts');
    expect(
      await screen.findByRole('link', { name: 'Incident: API is down' }),
    ).toHaveAttribute('href', '/incidents/inc-1');
    expect(screen.getByText('inbox · Delivered')).toBeVisible();
  });

  it('shows readers the settings without letting them change them', async () => {
    permissions = readOnly;
    await renderAt('/alerts');
    expect(await screen.findByText(copy.alerts.readOnly)).toBeVisible();
    expect(screen.getByText('Ada Ops')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: copy.actions.save }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: copy.alerts.events.incidentOpened }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(copy.alerts.deliveries.empty)).toBeVisible();
  });
});
