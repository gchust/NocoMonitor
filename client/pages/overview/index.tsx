import { useTranslation } from '@nocobase/i18n/client';
import {
  ActivityIcon,
  BotIcon,
  ExternalLinkIcon,
  RocketIcon,
  SirenIcon,
  TimerIcon,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, Outlet, useHref } from 'react-router';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#components/ui/empty';
import { Skeleton } from '#components/ui/skeleton';
import { cn } from 'cn';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatDuration,
  formatLatency,
  formatRelative,
  formatUptime,
  type AiBriefing,
  type DrillStatus,
  type Incident,
  type List,
  type Overview,
  type StatusPage,
} from '../../lib/monitoring.js';
import {
  HealthBadge,
  FalseAlarmBadge,
  IncidentStatusBadge,
  LoadError,
  SeverityBadge,
  StatusDot,
  UptimeBars,
} from '../monitoring/components.js';
import { AiPipelineCompact } from '../monitoring/ai-pipeline.js';
import { useDrillAction } from '../monitoring/drill-dialog.js';
import { usePipelineSteps } from '../monitoring/pipeline-steps.js';
import type { IncidentsOutletContext } from '../incidents/index.js';
import { useCanManage } from '../monitoring/utils.js';
import {
  DrillBanner,
  GetStartedCard,
  GetStartedSkeleton,
} from './get-started.js';
import { startSteps, useGetStartedMemory } from './get-started-state.js';
import {
  AgentFeedCard,
  AiOnCallCard,
  AllClearCard,
  AttentionCard,
  BRIEFING_DAYS,
} from './ai-on-call.js';

/** The operator's landing page: what is broken now, what the agent made of it, and how each service has been doing. */
export default function OverviewPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const overview = useApiData<{ data: Overview }>(
    'statusOverview',
    { days: 90 },
    { refreshMs: 15000 },
  );
  const pages = useApiData<List<StatusPage>>('statusPages');
  const briefing = useApiData<{ data: AiBriefing }>(
    'monitoringAi/briefing',
    { days: BRIEFING_DAYS },
    { refreshMs: 15000 },
  );
  const canManage = useCanManage();
  const memory = useGetStartedMemory();
  const startHidden = memory.hidden;
  const [drillRunning, setDrillRunning] = useState(false);
  const pageRef = useRef<HTMLElement>(null);
  const drill = useApiData<{ data: DrillStatus }>(
    'monitoringDrill',
    undefined,
    {
      // A running drill moves every few seconds; otherwise it only changes when someone starts one, here or on the AI page.
      refreshMs: drillRunning ? 5000 : undefined,
    },
  );
  const drillStatus = drill.data?.data;
  const drillAction = useDrillAction({ onSettled: () => drill.reload() });
  if ((drillStatus?.state === 'running') !== drillRunning)
    setDrillRunning(drillStatus?.state === 'running');
  const attention = briefing.data?.data.needsYou ?? [];
  const pendingFixes = new Map(
    (briefing.data?.data.pendingFixes ?? []).map((item) => [
      item.incidentId,
      item.actionTitle,
    ]),
  );
  const data = overview.data?.data;
  const publicPage = pages.data?.data.find((page) => page.published);
  const publicHref = useHref(publicPage ? `/status/${publicPage.slug}` : '/');

  // The drill's own monitor and incident show in its panel, not in the page's figures.
  const isDrill = (serviceId: string | null): boolean =>
    Boolean(drillStatus?.serviceId) && serviceId === drillStatus?.serviceId;
  const services =
    data?.services.filter((entry) => !isDrill(entry.service.id)) ?? [];
  const monitors = services.flatMap((entry) => entry.monitors);
  const ownMonitors = monitors.length;
  const steps = startSteps({
    agent: briefing.data?.data.agent,
    ownMonitors,
    drill: drillStatus,
  });
  const startOpen = steps.some((step) => !step.done);
  const startLoaded =
    Boolean(drillStatus) && Boolean(data) && Boolean(briefing.data);
  const drillActive = Boolean(drillStatus) && drillStatus?.state !== 'idle';
  // Getting started shows until every step is done or this viewer hides it; a drill keeps it until the drill ends.
  const showStart =
    canManage && startLoaded && !startHidden && (startOpen || drillActive);
  // Hidden while a drill runs: a slim banner still says so.
  const showBanner = canManage && startLoaded && startHidden && drillActive;
  // Placeholders only where the card is expected: not for a viewer who hid it or already finished it.
  const startLoading =
    canManage &&
    !startLoaded &&
    !startHidden &&
    !memory.knownDone &&
    !drill.error &&
    !overview.error;
  const allDone = startLoaded && !startOpen && !drillActive;
  const { setKnownDone } = memory;
  useEffect(() => {
    if (startLoaded) setKnownDone(allDone);
  }, [startLoaded, allDone, setKnownDone]);
  // Hiding or showing removes the button that was pressed: focus moves to what took its place.
  const showButtonRef = useRef<HTMLButtonElement>(null);
  const startCardRef = useRef<HTMLDivElement>(null);
  const focusAfterRef = useRef<'show' | 'card' | null>(null);
  // After every render: the one that follows hiding or showing has the new button or card in place.
  useEffect(() => {
    if (!focusAfterRef.current) return;
    (focusAfterRef.current === 'card'
      ? startCardRef
      : showButtonRef
    ).current?.focus();
    focusAfterRef.current = null;
  });
  const hideStart = (): void => {
    memory.setHidden(true);
    focusAfterRef.current = 'show';
  };
  const showStartCard = (): void => {
    memory.setHidden(false);
    focusAfterRef.current = 'card';
  };
  const refresh = (): void => {
    overview.reload();
    briefing.reload();
    drill.reload();
  };
  const open =
    data?.incidents.filter((incident) => incident.status !== 'resolved') ?? [];
  const openOwn = open.filter((incident) => !isDrill(incident.serviceId));
  const down = monitors.filter((monitor) => monitor.status === 'down').length;
  const degraded = monitors.filter(
    (monitor) => monitor.status === 'degraded',
  ).length;
  const latencies = monitors
    .map((monitor) => monitor.lastLatencyMs)
    .filter((value): value is number => value !== null);
  // Weighted by checks across every service, not an average of the services' percentages: a service with a handful of
  // checks must not weigh as much as one probed every minute.
  const days = services.flatMap((entry) => entry.days);
  const checks = days.reduce((sum, day) => sum + day.total, 0);
  const uptime = checks
    ? days.reduce((sum, day) => sum + day.up + day.degraded, 0) / checks
    : null;

  return (
    <>
      <PageContainer
        ref={pageRef}
        tabIndex={-1}
        className='mx-auto max-w-7xl outline-none'
      >
        <PageHeader
          title={t('monitoring.overview.title')}
          description={t('monitoring.overview.description')}
          actions={
            <>
              {canManage && startHidden && startOpen && !drillActive ? (
                <Button
                  ref={showButtonRef}
                  variant='ghost'
                  onClick={showStartCard}
                >
                  <RocketIcon data-icon='inline-start' />
                  {t('monitoring.start.show')}
                </Button>
              ) : null}
              {publicPage ? (
                <Button
                  variant='outline'
                  nativeButton={false}
                  render={
                    <a href={publicHref} target='_blank' rel='noreferrer' />
                  }
                >
                  <ExternalLinkIcon data-icon='inline-start' />
                  {t('monitoring.overview.openPublicPage')}
                </Button>
              ) : null}
            </>
          }
        />

        {startLoading ? <GetStartedSkeleton /> : null}
        {showStart && drillStatus ? (
          <GetStartedCard
            ref={startCardRef}
            agent={briefing.data?.data.agent}
            ownMonitors={ownMonitors}
            drill={drillStatus}
            onHide={hideStart}
            onChanged={refresh}
            onEnded={() => pageRef.current?.focus()}
          />
        ) : null}
        {showBanner && drillStatus ? (
          <DrillBanner
            ref={showButtonRef}
            drill={drillStatus}
            onShow={showStartCard}
          />
        ) : null}

        <AiOnCallCard
          briefing={briefing}
          canManage={canManage}
          // Getting started already leads with setting up the agent: here it is a second way there.
          secondarySetup={showStart && !steps[0].done}
          // Getting started offers the drill itself while it shows.
          onStartDrill={
            canManage && !showStart && drillStatus?.state === 'idle'
              ? () => drillAction.ask('start')
              : undefined
          }
        />
        {drillAction.dialog}

        {overview.error && !data ? (
          <LoadError error={overview.error} onRetry={overview.reload} />
        ) : null}

        <section
          className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'
          aria-label={t('monitoring.overview.summary')}
        >
          <Stat
            icon={<ActivityIcon />}
            label={t('monitoring.overview.monitorsUp')}
            value={
              data
                ? `${monitors.filter((m) => m.status === 'up').length} / ${monitors.length}`
                : undefined
            }
            hint={
              data
                ? down || degraded
                  ? t('monitoring.overview.downDegraded', { down, degraded })
                  : t('monitoring.overview.allUp')
                : undefined
            }
            tone={down ? 'danger' : degraded ? 'warning' : 'success'}
          />
          <Stat
            icon={<SirenIcon />}
            label={t('monitoring.overview.openIncidents')}
            value={data ? String(openOwn.length) : undefined}
            hint={data ? t('monitoring.overview.incidentsHint') : undefined}
            tone={openOwn.length ? 'danger' : 'success'}
          />
          <Stat
            icon={<TimerIcon />}
            label={t('monitoring.overview.medianLatency')}
            value={data ? formatLatency(median(latencies)) : undefined}
            hint={data ? t('monitoring.overview.latencyHint') : undefined}
          />
          <Stat
            icon={<ActivityIcon />}
            label={t('monitoring.overview.uptime90')}
            value={data ? formatUptime(uptime, i18n.language) : undefined}
            hint={data ? t('monitoring.overview.uptimeHint') : undefined}
          />
        </section>

        <div className='grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
          <div className='flex min-w-0 flex-col gap-6'>
            {attention.length ? (
              <AttentionCard
                items={attention}
                total={briefing.data?.data.stats.needsYou ?? attention.length}
              />
            ) : null}
            {open.length ? (
              <section
                className='flex flex-col gap-3'
                aria-labelledby='overview-open-incidents'
              >
                <h2
                  id='overview-open-incidents'
                  className='text-base font-medium'
                >
                  {t('monitoring.overview.activeIncidents')}
                </h2>
                <ul className='flex flex-col gap-3'>
                  {open.map((incident) => (
                    <li key={incident.id}>
                      <ActiveIncident
                        incident={incident}
                        pendingFix={pendingFixes.get(incident.id) ?? null}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {/* A briefing that failed to load still lets "all clear" show: nothing open is the main fact. */}
            {data &&
            (briefing.data || briefing.error) &&
            !open.length &&
            !attention.length ? (
              <AllClearCard />
            ) : null}
          </div>
          <AgentFeedCard briefing={briefing} />
        </div>

        <section className='space-y-3' aria-labelledby='overview-services'>
          <h2 id='overview-services' className='text-base font-medium'>
            {t('monitoring.overview.services')}
          </h2>
          {!data && overview.loading ? (
            <div className='grid gap-4'>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className='h-40 rounded-xl' />
              ))}
            </div>
          ) : data && !data.services.length ? (
            <Empty className='border'>
              <EmptyHeader>
                <EmptyTitle>{t('monitoring.overview.noServices')}</EmptyTitle>
                <EmptyDescription>
                  {t('monitoring.overview.noServicesHint')}
                </EmptyDescription>
              </EmptyHeader>
              <Button nativeButton={false} render={<Link to='services' />}>
                {t('monitoring.services.add')}
              </Button>
            </Empty>
          ) : (
            <div className='grid gap-4'>
              {data?.services.map((entry) => (
                <Card key={entry.service.id}>
                  <CardHeader>
                    <div className='flex flex-wrap items-center gap-3'>
                      <CardTitle>{entry.service.name}</CardTitle>
                      <HealthBadge health={entry.health} />
                      <span className='ml-auto text-sm text-muted-foreground'>
                        {t('monitoring.uptime.ninetyDays', {
                          uptime: formatUptime(entry.uptime, i18n.language),
                        })}
                      </span>
                    </div>
                    {entry.service.description ? (
                      <CardDescription>
                        {entry.service.description}
                      </CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <UptimeBars days={entry.days} />
                    <div className='flex justify-between text-xs text-muted-foreground'>
                      <span>
                        {t('monitoring.uptime.daysAgo', {
                          count: entry.days.length,
                        })}
                      </span>
                      <span>{t('monitoring.uptime.today')}</span>
                    </div>
                    <ul className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
                      {entry.monitors.map((monitor) => (
                        <li key={monitor.id}>
                          <Link
                            to={`monitors/${monitor.id}`}
                            className='flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted'
                          >
                            <StatusDot status={monitor.status} />
                            <span className='min-w-0 flex-1 truncate'>
                              {monitor.name}
                            </span>
                            <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                              {monitor.status === 'paused'
                                ? t('monitoring.monitorStatus.paused')
                                : formatLatency(monitor.lastLatencyMs)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {entry.monitors.length ? (
                      <p className='text-xs text-muted-foreground'>
                        {t('monitoring.overview.lastChecked', {
                          when: formatRelative(
                            latest(entry.monitors.map((m) => m.lastCheckedAt)),
                            i18n.language,
                          ),
                        })}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </PageContainer>
      {/* The incident opened from this page covers it; deciding there refreshes what this page shows. */}
      <Outlet context={{ reload: refresh } satisfies IncidentsOutletContext} />
    </>
  );
}

/** An open incident: its state, how long it lasts, how far the automatic response got, and the agent's conclusion. */
function ActiveIncident({
  incident,
  pendingFix,
}: {
  readonly incident: Incident;
  readonly pendingFix: string | null;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const steps = usePipelineSteps({ incident, pendingFix });
  return (
    <Link
      to={`incident/${incident.id}`}
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4 transition-colors',
        // A false alarm the agent called is not an outage: it does not look like one.
        incident.aiVerdict === 'falseAlarm'
          ? 'border-primary/20 bg-primary/5 hover:bg-primary/8'
          : 'border-destructive/25 bg-destructive/5 hover:bg-destructive/8',
      )}
    >
      <div className='flex flex-wrap items-center gap-2'>
        <IncidentStatusBadge status={incident.status} />
        <SeverityBadge severity={incident.severity} />
        <FalseAlarmBadge incident={incident} />
        <span className='ml-auto text-xs text-muted-foreground'>
          {t('monitoring.incidents.lasting', {
            duration: formatDuration(incident.startedAt, null, i18n.language),
          })}
        </span>
      </div>
      <p className='font-medium'>{incident.title}</p>
      <AiPipelineCompact steps={steps} />
      <p className='flex items-start gap-1.5 text-sm text-muted-foreground'>
        <BotIcon className='mt-0.5 size-4 shrink-0' />
        <span className='line-clamp-2'>
          {incident.aiSummary ?? t(`monitoring.ai.state.${incident.aiState}`)}
        </span>
      </p>
    </Link>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string | undefined;
  readonly hint: string | undefined;
  readonly tone?: 'success' | 'warning' | 'danger';
}): ReactElement {
  const toneClass =
    tone === 'danger'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-(--status-warning)'
        : tone === 'success'
          ? 'text-(--status-success)'
          : 'text-muted-foreground';
  return (
    <Card size='sm'>
      <CardContent className='space-y-1'>
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <span className={`[&>svg]:size-4 ${toneClass}`}>{icon}</span>
          {label}
        </div>
        {value === undefined ? (
          <Skeleton className='h-8 w-24' />
        ) : (
          <p className='font-heading text-2xl font-semibold tabular-nums tracking-tight'>
            {value}
          </p>
        )}
        <p className='min-h-4 text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  );
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function latest(values: readonly (string | null)[]): string | null {
  return values.reduce<string | null>(
    (max, value) => (value && (!max || value > max) ? value : max),
    null,
  );
}
