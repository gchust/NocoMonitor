// The AI on-call surfaces: the overview's AI card, what waits on people and the agent feed, and the incident page's
// automatic response card with its approval. The real pages render with application hooks; the API answers here.
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
import type { ReactElement } from 'react';
import { Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import packageMetadata from '../../package.json' with { type: 'json' };
import enUS from '../../client/locales/en-US.js';
import {
  downRuns,
  groupIncidents,
  type AiBriefing,
  type Check,
  type Incident,
  type Remediation,
} from '../../client/lib/monitoring.js';
import IncidentDetailPage from '../../client/pages/incidents/detail.js';
import OverviewPage from '../../client/pages/overview/index.js';

const copy = enUS.monitoring;
const getSession = vi.fn(async () => ({ data: null }));
let permissions: AuthorizationSnapshot;
let briefing: AiBriefing;
let incident: Incident;
let remediations: Remediation[];
let rejectAnswer: () => unknown;
let monitor: { id: string; name: string; status: string } | null;
let group: { lead: Incident | null; members: unknown[] };
let overviewIncidents: () => Incident[];

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

const api = vi.fn(({ method, path }: ApiCall) => {
  if (method === 'GET' && path === 'authorization/permissions')
    return { data: permissions };
  if (method === 'GET' && path === 'statusOverview')
    return { data: { services: [], incidents: overviewIncidents() } };
  if (method === 'GET' && path === 'statusPages') return { data: [] };
  if (method === 'GET' && path === 'monitoringAi/briefing')
    return { data: briefing };
  if (method === 'GET' && path === `incidents/${incident.id}`)
    return {
      data: { incident, service: null, monitor, updates: [], group },
    };
  if (method === 'GET' && path === `incidents/${incident.id}/remediations`)
    return { data: { level: 'approve', actions: [], remediations } };
  if (method === 'GET' && path === `incidents/${incident.id}/aiActivity`)
    return {
      data: {
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-10-27T10:00:00Z',
        finishedAt: '2026-10-27T10:01:30Z',
        model: 'model',
        steps: [
          { seq: 3, at: '2026-10-27T10:00:10Z', kind: 'probe' },
          { seq: 7, at: '2026-10-27T10:00:40Z', kind: 'code' },
        ],
      },
    };
  if (method === 'POST' && path === `incidents/${incident.id}/updates`)
    return { data: { id: 'u-2' } };
  if (method === 'POST' && path === 'remediations/fix-1/reject')
    return rejectAnswer();
  if (method === 'POST' && path === 'remediations/fix-1/approve')
    return { data: { ...remediations[0], status: 'verifying' } };
  return new Response(null, { status: 404 });
});

function emptyBriefing(): AiBriefing {
  return {
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
      incidents: 4,
      diagnosed: 3,
      medianTimeToDiagnosisMs: 120_000,
      fixesRequested: 2,
      fixesVerified: 1,
      needsYou: 1,
    },
    needsYou: [
      {
        kind: 'approval',
        incidentId: 'inc-1',
        incidentTitle: 'API is down',
        at: new Date().toISOString(),
        actionTitle: 'Restart',
      },
    ],
    pendingFixes: [{ incidentId: 'inc-1', actionTitle: 'Restart' }],
    feed: [
      {
        id: 'u1',
        kind: 'diagnosis',
        authorType: 'agent',
        incidentId: 'inc-1',
        incidentTitle: 'API is down',
        at: new Date().toISOString(),
        text: 'The database pool is exhausted.',
      },
    ],
  };
}

function ParentPage(): ReactElement {
  return <Outlet context={{ reload: () => undefined }} />;
}

async function renderAt(route: string) {
  return renderWithApp(
    <AuthenticationProvider>
      <Routes>
        <Route path='/' element={<OverviewPage />}>
          <Route path='incident/:incidentId' element={<IncidentDetailPage />} />
        </Route>
        <Route path='/incidents' element={<ParentPage />}>
          <Route path=':incidentId' element={<IncidentDetailPage />} />
        </Route>
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
  briefing = emptyBriefing();
  rejectAnswer = () => ({ data: null });
  monitor = null;
  group = { lead: null, members: [] };
  overviewIncidents = () => [incident];
  incident = {
    id: 'inc-1',
    serviceId: 'svc-1',
    monitorId: null,
    title: 'API is down',
    status: 'investigating',
    severity: 'major',
    source: 'auto',
    groupId: null,
    publicVisible: false,
    startedAt: '2026-10-27T10:00:00Z',
    resolvedAt: null,
    aiState: 'completed',
    aiRunId: 'run-1',
    aiSummary: 'The database pool is exhausted.',
    aiRootCause: '- Every check times out\n- The pool reports 100/100',
    aiConfidence: 'high',
    aiSuggestedActions: [],
    aiUpdatedAt: '2026-10-27T10:02:00Z',
    createdAt: '2026-10-27T10:00:00Z',
    updatedAt: '2026-10-27T10:02:00Z',
  } as Incident;
  remediations = [
    {
      id: 'fix-1',
      incidentId: 'inc-1',
      actionKey: 'restart',
      actionTitle: 'Restart',
      reason: 'The pool is exhausted',
      status: 'pending',
      requestedByType: 'agent',
      requestedByName: 'Claude',
      decidedByName: null,
      decidedAt: null,
      executedAt: null,
      httpStatus: null,
      output: null,
      verifyAt: null,
      verifiedAt: null,
      createdAt: '2026-10-27T10:03:00Z',
    },
  ];
});

describe('overview AI on-call', () => {
  it('shows the agent on call, its week, what waits on people and its activity', async () => {
    await renderAt('/');

    expect(await screen.findByText(copy.oncall.title.online)).toBeVisible();
    expect(screen.getByText(copy.oncall.online)).toBeVisible();
    // The model is part of the discovered agent's name, so it is not repeated.
    expect(screen.getByText('Claude · sonnet')).toBeVisible();
    expect(screen.getByText('3 / 4')).toBeVisible();
    expect(screen.getByText('1 of 2')).toBeVisible();
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '#overview-attention',
    );
    // Permissions arrive after the briefing: the item then asks the viewer to approve.
    expect(
      await screen.findByRole('link', { name: /Approve fix “Restart”/ }),
    ).toHaveAttribute('href', '/incident/inc-1');
    // Everything waiting is listed: no footer.
    expect(screen.queryByText(/Showing 1 of/)).not.toBeInTheDocument();
    // The active incident names the step that waits, in words.
    expect(
      screen.getByRole('img', { name: /Fix waiting for you/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('The database pool is exhausted.').length,
    ).toBeGreaterThan(0);
    expect(api).toHaveBeenCalledWith({
      method: 'GET',
      path: 'monitoringAi/briefing',
      query: { days: '7' },
    });
  });

  it('offers to set up AI diagnosis only to people who manage monitoring', async () => {
    briefing = {
      ...emptyBriefing(),
      agent: {
        configured: false,
        enabled: true,
        name: null,
        tool: null,
        model: null,
        online: null,
        busy: 0,
      },
    };
    await renderAt('/');
    expect(
      await screen.findByRole('button', { name: copy.oncall.setUp }),
    ).toHaveAttribute('href', '/ai');

    permissions = readOnly;
    const view = await renderAt('/');
    await waitFor(() =>
      expect(
        within(view.container).getByText(copy.oncall.title.notConfigured),
      ).toBeVisible(),
    );
    expect(
      within(view.container).getByText(new RegExp(copy.oncall.askAdmin)),
    ).toBeVisible();
    expect(
      within(view.container).queryByRole('button', {
        name: copy.oncall.setUp,
      }),
    ).not.toBeInTheDocument();
  });

  it('says how many wait beyond the listed ones and leads to the open incidents', async () => {
    briefing = {
      ...emptyBriefing(),
      stats: { ...emptyBriefing().stats, needsYou: 12 },
    };
    await renderAt('/');
    expect(
      await screen.findByRole('button', {
        name: 'Showing 1 of 12 — view open incidents',
      }),
    ).toHaveAttribute('href', '/incidents');
  });

  it('says all is clear when nothing is open and nothing waits', async () => {
    incident = { ...incident, status: 'resolved' };
    briefing = {
      ...emptyBriefing(),
      needsYou: [],
      stats: { ...emptyBriefing().stats, needsYou: 0 },
    };
    await renderAt('/');
    expect(await screen.findByText(copy.oncall.allClear.title)).toBeVisible();
  });
});

describe('incident automatic response', () => {
  it('puts the fix waiting for approval first, and runs it only after confirmation', async () => {
    const view = await renderAt('/incidents/inc-1');

    expect(await screen.findByText(copy.pipeline.title)).toBeVisible();
    expect(
      await screen.findByText('The agent asks to run “Restart”.'),
    ).toBeVisible();
    expect(screen.getAllByText(copy.pipeline.fix.pending).length).toBe(1);
    // The diagnosis leads with its conclusion and lists its evidence.
    expect(screen.getByText('The pool reports 100/100').tagName).toBe('LI');
    // The investigation is folded with its count and duration, and shows steps, not commands.
    await userEvent.click(
      await screen.findByRole('button', { name: /How the agent investigated/ }),
    );
    expect(screen.getByText(copy.ai.activity.kind.probe)).toBeVisible();
    expect(screen.getByText(copy.ai.activity.kind.code)).toBeVisible();

    const [approve] = screen.getAllByRole('button', {
      name: copy.fixes.approve,
    });
    await userEvent.click(approve);
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Run fix “Restart”?',
    });
    expect(api).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'remediations/fix-1/approve' }),
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.fixes.confirm }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith({
        method: 'POST',
        path: 'remediations/fix-1/approve',
      }),
    );
    await waitFor(() =>
      expect(view.toasts()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'success',
            title: 'Fix “Restart” approved',
          }),
        ]),
      ),
    );
  });

  it('opens over the overview it was opened from, and goes back to it', async () => {
    await renderAt('/');
    await userEvent.click(
      await screen.findByRole('link', { name: /Approve fix “Restart”/ }),
    );
    expect(await screen.findByText(copy.pipeline.title)).toBeVisible();
    expect(screen.getByText(copy.oncall.title.online)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back/ })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it("names an already decided fix in the reader's words, and keeps focus in the card after rejecting", async () => {
    rejectAnswer = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            status: 'FAILED_PRECONDITION',
            reason: 'NOT_PENDING',
            message: 'The fix request is already rejected.',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    const view = await renderAt('/incidents/inc-1');
    const [reject] = await screen.findAllByRole('button', {
      name: copy.fixes.reject,
    });
    await userEvent.click(reject);
    await waitFor(() =>
      expect(view.toasts()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'error',
            title: copy.fixes.errors.notPending,
          }),
        ]),
      ),
    );

    rejectAnswer = () => ({ data: { ...remediations[0], status: 'rejected' } });
    await userEvent.click(reject);
    await waitFor(() =>
      expect(
        screen.getByText(copy.pipeline.title).closest('[data-slot=card]'),
      ).toHaveFocus(),
    );
  });

  it('shows no decision to a reader who cannot manage monitoring', async () => {
    permissions = readOnly;
    await renderAt('/incidents/inc-1');

    // The fix waits on someone who manages monitoring, not on this reader.
    expect(
      (await screen.findAllByText(copy.pipeline.fix.pendingOthers))[0],
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: copy.fixes.approve }),
    ).not.toBeInTheDocument();
  });
});

describe('false alarms', () => {
  beforeEach(() => {
    incident = {
      ...incident,
      monitorId: 'mon-1',
      aiVerdict: 'falseAlarm',
      aiSummary:
        'The path does not exist; the monitor points at the wrong URL.',
    };
    monitor = { id: 'mon-1', name: 'API health', status: 'down' };
    remediations = [];
  });

  it('offers to resolve the incident on the verdict, or to adjust the monitor', async () => {
    const view = await renderAt('/incidents/inc-1');

    expect(
      await screen.findByText(copy.pipeline.next.falseAlarm),
    ).toBeVisible();
    expect(screen.getByText(copy.ai.verdict.falseAlarm)).toBeVisible();
    expect(
      // A link rendered as a button, like the page's other actions.
      screen.getByRole('button', { name: copy.ai.verdict.editMonitor }),
    ).toHaveAttribute('href', '/monitors/mon-1?edit');

    await userEvent.click(
      screen.getByRole('button', { name: copy.ai.verdict.accept }),
    );
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith({
        method: 'POST',
        path: 'incidents/inc-1/updates',
        json: {
          status: 'resolved',
          body: 'Resolved on the AI diagnosis: The path does not exist; the monitor points at the wrong URL.',
          publicVisible: false,
        },
      }),
    );
    await waitFor(() =>
      expect(view.toasts()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'success',
            title: copy.ai.verdict.resolved,
          }),
        ]),
      ),
    );
  });

  it('marks the incident on the overview and leaves the decision to managers', async () => {
    permissions = readOnly;
    await renderAt('/');
    expect(
      await screen.findByText(copy.ai.verdict.falseAlarmBadge),
    ).toBeVisible();

    await renderAt('/incidents/inc-1');
    expect(
      screen.queryByRole('button', { name: copy.ai.verdict.accept }),
    ).not.toBeInTheDocument();
  });
});

describe('outage stretches on the latency chart', () => {
  const at = (minute: number) =>
    new Date(Date.UTC(2026, 9, 28, 0, minute)).toISOString();
  const check = (minute: number, status: 'up' | 'down') =>
    ({ checkedAt: at(minute), status }) as Check;

  it('runs from the first failure to the next answer, and stays visible when short', () => {
    expect(
      downRuns([
        check(0, 'up'),
        check(1, 'down'),
        check(2, 'down'),
        check(5, 'up'),
        check(6, 'down'),
      ]),
    ).toEqual([
      [Date.parse(at(1)), Date.parse(at(5))],
      [Date.parse(at(6)), Date.parse(at(7))],
    ]);
    expect(downRuns([check(0, 'up'), check(1, 'up')])).toEqual([]);
  });
});

describe('incidents opened together', () => {
  const member = (id: string, title: string): Incident => ({
    ...incident,
    id,
    title,
    groupId: 'inc-1',
    aiState: 'none',
    aiSummary: null,
  });

  it('folds the incidents that joined a group into the one leading it', () => {
    const joined = member('inc-2', 'ITAM is down');
    const orphan = { ...member('inc-3', 'Docs is down'), groupId: 'gone' };
    expect(groupIncidents([incident, joined, orphan])).toEqual([
      { incident, members: [joined] },
      { incident: orphan, members: [] },
    ]);
  });

  it('shows the group as one incident on the overview', async () => {
    overviewIncidents = () => [
      incident,
      member('inc-2', 'ITAM is down'),
      member('inc-3', 'Reach is down'),
    ];
    await renderAt('/');
    expect(
      await screen.findByText(
        copy.group.together_other.replace('{{count}}', '2'),
      ),
    ).toBeVisible();
    expect(screen.getByText('ITAM is down, Reach is down')).toBeVisible();
    expect(screen.getAllByRole('link', { name: /ITAM is down/ })).toHaveLength(
      1,
    );
  });

  it('lists the members on the lead, and leads a member to the lead and its diagnosis', async () => {
    group = {
      lead: null,
      members: [
        {
          id: 'inc-2',
          title: 'ITAM is down',
          status: 'investigating',
          monitorName: 'ITAM health',
        },
      ],
    };
    await renderAt('/incidents/inc-1');
    expect(
      await screen.findByText(copy.group.title_one.replace('{{count}}', '1')),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /ITAM is down/ })).toHaveAttribute(
      'href',
      '/incidents/inc-2',
    );
  });

  it('shows a member the lead’s diagnosis and no diagnosis of its own to ask for', async () => {
    const lead = incident;
    incident = member('inc-2', 'ITAM is down');
    group = { lead, members: [] };
    remediations = [];
    await renderAt('/incidents/inc-2');
    expect(
      await screen.findByText(
        copy.group.joined.replace('{{incident}}', 'API is down'),
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: copy.group.openLead }),
    ).toHaveAttribute('href', '/incidents/inc-1');
    expect(screen.getByText('The database pool is exhausted.')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: copy.ai.diagnose }),
    ).not.toBeInTheDocument();
  });
});
