import { useTranslation } from '@nocobase/i18n/client';
import {
  ActivityIcon,
  BotIcon,
  ExternalLinkIcon,
  SirenIcon,
  TimerIcon,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Link, useHref } from 'react-router';

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

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatDuration,
  formatLatency,
  formatRelative,
  formatUptime,
  type List,
  type Overview,
  type StatusPage,
} from '../../lib/monitoring.js';
import {
  HealthBadge,
  IncidentStatusBadge,
  LoadError,
  SeverityBadge,
  StatusDot,
  UptimeBars,
} from '../monitoring/components.js';

/** The operator's landing page: what is broken now, what the agent made of it, and how each service has been doing. */
export default function OverviewPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const overview = useApiData<{ data: Overview }>(
    'statusOverview',
    { days: 90 },
    { refreshMs: 15000 },
  );
  const pages = useApiData<List<StatusPage>>('statusPages');
  const data = overview.data?.data;
  const publicPage = pages.data?.data.find((page) => page.published);
  const publicHref = useHref(publicPage ? `/status/${publicPage.slug}` : '/');

  const monitors = data?.services.flatMap((entry) => entry.monitors) ?? [];
  const open =
    data?.incidents.filter((incident) => incident.status !== 'resolved') ?? [];
  const down = monitors.filter((monitor) => monitor.status === 'down').length;
  const degraded = monitors.filter(
    (monitor) => monitor.status === 'degraded',
  ).length;
  const latencies = monitors
    .map((monitor) => monitor.lastLatencyMs)
    .filter((value): value is number => value !== null);
  const measured =
    data?.services.filter((entry) => entry.uptime !== null) ?? [];
  const uptime = measured.length
    ? measured.reduce((sum, entry) => sum + (entry.uptime ?? 0), 0) /
      measured.length
    : null;

  return (
    <PageContainer className='mx-auto max-w-7xl'>
      <PageHeader
        title={t('monitoring.overview.title')}
        description={t('monitoring.overview.description')}
        actions={
          publicPage ? (
            <Button
              variant='outline'
              nativeButton={false}
              render={<a href={publicHref} target='_blank' rel='noreferrer' />}
            >
              <ExternalLinkIcon data-icon='inline-start' />
              {t('monitoring.overview.openPublicPage')}
            </Button>
          ) : null
        }
      />

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
          value={data ? String(open.length) : undefined}
          hint={data ? t('monitoring.overview.incidentsHint') : undefined}
          tone={open.length ? 'danger' : 'success'}
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

      {open.length ? (
        <section
          className='space-y-3'
          aria-labelledby='overview-open-incidents'
        >
          <h2 id='overview-open-incidents' className='text-base font-medium'>
            {t('monitoring.overview.activeIncidents')}
          </h2>
          <ul className='grid gap-3 lg:grid-cols-2'>
            {open.map((incident) => (
              <li key={incident.id}>
                <Link
                  to={`incidents/${incident.id}`}
                  className='block rounded-xl border border-destructive/25 bg-destructive/5 p-4 transition-colors hover:bg-destructive/8'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <IncidentStatusBadge status={incident.status} />
                    <SeverityBadge severity={incident.severity} />
                    <span className='ml-auto text-xs text-muted-foreground'>
                      {t('monitoring.incidents.lasting', {
                        duration: formatDuration(incident.startedAt, null),
                      })}
                    </span>
                  </div>
                  <p className='mt-2 font-medium'>{incident.title}</p>
                  <p className='mt-1 flex items-start gap-1.5 text-sm text-muted-foreground'>
                    <BotIcon className='mt-0.5 size-4 shrink-0' />
                    <span className='line-clamp-2'>
                      {incident.aiSummary ??
                        t(`monitoring.ai.state.${incident.aiState}`)}
                    </span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
