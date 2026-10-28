import { useTranslation } from '@nocobase/i18n/client';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
import { cn } from 'cn';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatDateTime,
  formatRelative,
  formatUptime,
  type IncidentSeverity,
  type IncidentStatus,
  type MonitorStatus,
  type ServiceHealth,
  type UptimeDay,
} from '../../lib/monitoring.js';
import {
  IncidentStatusBadge,
  LoadError,
  StatusDot,
  UptimeBars,
} from '../monitoring/components.js';

interface PublicStatus {
  page: { slug: string; title: string; description: string | null };
  health: ServiceHealth;
  services: {
    id: string;
    name: string;
    description: string | null;
    health: ServiceHealth;
    uptime: number | null;
    days: UptimeDay[];
    components: {
      name: string;
      region: string | null;
      status: MonitorStatus;
    }[];
  }[];
  /** Incidents the probes opened and resolved within `blipMinutes`: counted, not listed. */
  blips: number;
  blipMinutes: number;
  incidents: {
    id: string;
    serviceId: string;
    title: string;
    status: IncidentStatus;
    severity: IncidentSeverity;
    startedAt: string;
    resolvedAt: string | null;
    /** How many monitors' incidents this one stands for: more than 1 when it leads a group. */
    affected: number;
    updates: {
      status: IncidentStatus | null;
      body: string;
      createdAt: string;
    }[];
  }[];
  generatedAt: string;
}

const BANNER: Record<
  ServiceHealth,
  { className: string; icon: typeof CircleCheckIcon }
> = {
  operational: {
    className: 'bg-(--status-success) text-white',
    icon: CircleCheckIcon,
  },
  degraded: {
    className: 'bg-(--status-warning) text-white',
    icon: TriangleAlertIcon,
  },
  maintenance: {
    className: 'bg-primary text-primary-foreground',
    icon: TriangleAlertIcon,
  },
  partialOutage: {
    className: 'bg-destructive text-white',
    icon: CircleAlertIcon,
  },
  majorOutage: {
    className: 'bg-destructive text-white',
    icon: CircleAlertIcon,
  },
  unknown: { className: 'bg-muted text-foreground', icon: TriangleAlertIcon },
};

/** The page customers read: readable without signing in, and showing only what the operators made public. */
export default function PublicStatusPage(): ReactElement {
  const { slug = '' } = useParams();
  const { t, i18n } = useTranslation();
  const status = useApiData<{ data: PublicStatus }>(
    `publicStatusPages/${encodeURIComponent(slug)}`,
    undefined,
    {
      refreshMs: 60000,
    },
  );
  const data = status.data?.data;

  useEffect(() => {
    if (data) document.title = data.page.title;
  }, [data]);

  const active =
    data?.incidents.filter((incident) => incident.status !== 'resolved') ?? [];
  const past =
    data?.incidents.filter((incident) => incident.status === 'resolved') ?? [];
  const banner = data ? BANNER[data.health] : undefined;
  const [showAll, setShowAll] = useState(false);
  const shownPast = showAll ? past : past.slice(0, PAST_SHOWN);

  return (
    <div className='min-h-screen bg-background text-foreground'>
      <main className='mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6 sm:py-14'>
        {status.error && !data ? (
          <LoadError error={status.error} onRetry={status.reload} />
        ) : null}
        {!data && status.loading ? (
          <div className='space-y-6'>
            <Skeleton className='h-10 w-64' />
            <Skeleton className='h-16 rounded-xl' />
            <Skeleton className='h-80 rounded-xl' />
          </div>
        ) : null}
        {data && banner ? (
          <>
            <header className='space-y-2'>
              <h1 className='font-heading text-3xl font-semibold tracking-[-0.035em]'>
                {data.page.title}
              </h1>
              {data.page.description ? (
                <p className='text-muted-foreground'>{data.page.description}</p>
              ) : null}
            </header>

            <div
              className={cn(
                'flex items-center gap-3 rounded-xl px-5 py-4 text-lg font-medium',
                banner.className,
              )}
            >
              <banner.icon className='size-6 shrink-0' />
              {t(`monitoring.public.banner.${data.health}`)}
            </div>

            {active.length ? (
              <section className='space-y-4' aria-labelledby='public-active'>
                <h2 id='public-active' className='text-lg font-medium'>
                  {t('monitoring.public.activeIncidents')}
                </h2>
                {active.map((incident) => (
                  <IncidentBlock key={incident.id} incident={incident} />
                ))}
              </section>
            ) : null}

            <section
              className='overflow-hidden rounded-xl border'
              aria-label={t('monitoring.public.services')}
            >
              {data.services.map((service) => (
                <div
                  key={service.id}
                  className='space-y-3 border-b p-5 last:border-b-0'
                >
                  <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
                    <h3 className='font-medium'>{service.name}</h3>
                    <span className='text-sm text-muted-foreground'>
                      {t(`monitoring.health.${service.health}`)}
                    </span>
                    <span className='ml-auto text-sm text-muted-foreground tabular-nums'>
                      {t('monitoring.uptime.ninetyDays', {
                        uptime: formatUptime(service.uptime, i18n.language),
                      })}
                    </span>
                  </div>
                  <UptimeBars days={service.days} />
                  <div className='flex justify-between text-xs text-muted-foreground'>
                    <span>
                      {t('monitoring.uptime.daysAgo', {
                        count: service.days.length,
                      })}
                    </span>
                    <span>{t('monitoring.uptime.today')}</span>
                  </div>
                  <ul className='flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground'>
                    {service.components.map((component) => (
                      <li
                        key={`${component.name}-${component.region ?? ''}`}
                        className='flex items-center gap-1.5'
                      >
                        <StatusDot status={component.status} />
                        {component.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            <section className='space-y-4' aria-labelledby='public-history'>
              <h2 id='public-history' className='text-lg font-medium'>
                {t('monitoring.public.pastIncidents')}
              </h2>
              {shownPast.map((incident) => (
                <IncidentBlock key={incident.id} incident={incident} />
              ))}
              {past.length > shownPast.length ? (
                <Button variant='outline' onClick={() => setShowAll(true)}>
                  {t('monitoring.public.showAll', { count: past.length })}
                </Button>
              ) : null}
              {!past.length && !data.blips ? (
                <p className='text-sm text-muted-foreground'>
                  {t('monitoring.public.noPastIncidents')}
                </p>
              ) : null}
              {data.blips ? (
                <p className='text-sm text-muted-foreground'>
                  {t('monitoring.public.blips', {
                    count: data.blips,
                    minutes: data.blipMinutes,
                  })}
                </p>
              ) : null}
            </section>

            <footer className='flex flex-wrap justify-between gap-2 border-t pt-6 text-xs text-muted-foreground'>
              <span>
                {t('monitoring.public.updated', {
                  when: formatRelative(data.generatedAt, i18n.language),
                })}
              </span>
              <span>{t('monitoring.public.poweredBy')}</span>
            </footer>
          </>
        ) : null}
      </main>
    </div>
  );
}

/** Past incidents listed before "Show all": the latest few are what a visitor reads. */
const PAST_SHOWN = 5;

function IncidentBlock({
  incident,
}: {
  readonly incident: PublicStatus['incidents'][number];
}): ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <article className='space-y-3 rounded-xl border p-5'>
      <div className='flex flex-wrap items-center gap-2'>
        <IncidentStatusBadge status={incident.status} />
        <h3 className='font-medium'>{incident.title}</h3>
        {incident.affected > 1 ? (
          <span className='text-sm text-muted-foreground'>
            {t('monitoring.public.affected', { count: incident.affected })}
          </span>
        ) : null}
        <span className='ml-auto text-xs text-muted-foreground'>
          {formatDateTime(incident.startedAt, i18n.language)}
        </span>
      </div>
      <ol className='space-y-3'>
        {[...incident.updates].reverse().map((update) => (
          <li key={update.createdAt} className='text-sm'>
            <span className='font-medium'>
              {update.status
                ? `${t(`monitoring.incidentStatus.${update.status}`)} — `
                : ''}
            </span>
            <span className='whitespace-pre-wrap'>{update.body}</span>
            <div className='mt-0.5 text-xs text-muted-foreground'>
              {formatDateTime(update.createdAt, i18n.language)}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
