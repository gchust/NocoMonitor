import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CircleAlertIcon, LayersIcon, SparklesIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { StatusBadge } from '#components/status-badge';
import { Alert, AlertTitle } from '#components/ui/alert';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#components/ui/tooltip';
import { cn } from 'cn';

import {
  formatDay,
  formatLatency,
  formatUptime,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
  type MonitorStatus,
  type ServiceHealth,
  type UptimeDay,
} from '../../lib/monitoring.js';

const HEALTH_TONE: Record<
  ServiceHealth,
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  operational: 'success',
  degraded: 'warning',
  partialOutage: 'danger',
  majorOutage: 'danger',
  maintenance: 'info',
  unknown: 'neutral',
};

const MONITOR_TONE: Record<
  MonitorStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  up: 'success',
  degraded: 'warning',
  down: 'danger',
  pending: 'neutral',
  paused: 'neutral',
};

const DOT_CLASS = {
  success: 'bg-(--status-success)',
  warning: 'bg-(--status-warning)',
  danger: 'bg-destructive',
  info: 'bg-primary',
  neutral: 'bg-muted-foreground/50',
};

function Tone({
  tone,
  children,
  pulse = false,
}: {
  readonly tone: keyof typeof DOT_CLASS;
  readonly children: ReactNode;
  readonly pulse?: boolean;
}): ReactElement {
  const dot = (
    <span
      aria-hidden
      className={cn(
        'size-2 shrink-0 rounded-full',
        DOT_CLASS[tone],
        pulse && 'animate-pulse',
      )}
    />
  );
  if (tone === 'danger')
    return (
      <Badge
        variant='outline'
        className='gap-1.5 border-destructive/25 bg-destructive/8 text-destructive'
      >
        {dot}
        {children}
      </Badge>
    );
  return (
    <StatusBadge tone={tone === 'info' ? 'info' : tone} className='gap-1.5'>
      {dot}
      {children}
    </StatusBadge>
  );
}

export function HealthBadge({
  health,
}: {
  readonly health: ServiceHealth;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Tone tone={HEALTH_TONE[health]}>{t(`monitoring.health.${health}`)}</Tone>
  );
}

export function MonitorStatusBadge({
  status,
}: {
  readonly status: MonitorStatus;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Tone tone={MONITOR_TONE[status]} pulse={status === 'down'}>
      {t(`monitoring.monitorStatus.${status}`)}
    </Tone>
  );
}

/** A dot alone, for dense rows where the word would repeat on every line. */
export function StatusDot({
  status,
  className,
}: {
  readonly status: MonitorStatus;
  readonly className?: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <span
      role='img'
      aria-label={t(`monitoring.monitorStatus.${status}`)}
      title={t(`monitoring.monitorStatus.${status}`)}
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        DOT_CLASS[MONITOR_TONE[status]],
        className,
      )}
    />
  );
}

export function IncidentStatusBadge({
  status,
}: {
  readonly status: IncidentStatus;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Tone
      tone={
        status === 'resolved'
          ? 'success'
          : status === 'monitoring'
            ? 'info'
            : 'warning'
      }
    >
      {t(`monitoring.incidentStatus.${status}`)}
    </Tone>
  );
}

export function SeverityBadge({
  severity,
}: {
  readonly severity: IncidentSeverity;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={severity === 'minor' ? 'neutral' : 'warning'}
      className={cn(
        severity === 'critical' &&
          'border-destructive/25 bg-destructive/8 text-destructive',
      )}
    >
      {t(`monitoring.severity.${severity}`)}
    </StatusBadge>
  );
}

/** The agent judged the incident a false alarm: the service works, the monitor needs changing. Nothing otherwise. */
export function FalseAlarmBadge({
  incident,
}: {
  readonly incident: Pick<Incident, 'aiVerdict'>;
}): ReactElement | null {
  const { t } = useTranslation();
  if (incident.aiVerdict !== 'falseAlarm') return null;
  return (
    <StatusBadge tone='info'>
      <SparklesIcon className='size-3' />
      {t('monitoring.ai.verdict.falseAlarmBadge')}
    </StatusBadge>
  );
}

/** The incidents that joined a group, on the entry of the incident leading it. Nothing for an incident alone. */
export function GroupedLine({
  members,
}: {
  readonly members: readonly Pick<Incident, 'id' | 'title'>[];
}): ReactElement | null {
  const { t } = useTranslation();
  if (!members.length) return null;
  return (
    <p className='flex items-start gap-1.5 text-sm text-muted-foreground'>
      <LayersIcon className='mt-0.5 size-4 shrink-0 text-primary' />
      <span className='min-w-0'>
        <span className='font-medium text-foreground'>
          {t('monitoring.group.together', { count: members.length })}
        </span>{' '}
        <span className='line-clamp-1'>
          {members
            .map((member) => member.title)
            .join(t('monitoring.group.separator'))}
        </span>
      </span>
    </p>
  );
}

function dayTone(day: UptimeDay): keyof typeof DOT_CLASS {
  if (!day.total) return 'neutral';
  if (day.down > 0 && (day.uptime ?? 1) < 0.95) return 'danger';
  if (day.down > 0 || day.degraded > 0) return 'warning';
  return 'success';
}

/** One bar per day, oldest on the left: the familiar strip of a status page. */
export function UptimeBars({
  days,
  className,
}: {
  readonly days: readonly UptimeDay[];
  readonly className?: string;
}): ReactElement {
  const { t, i18n } = useTranslation();
  return (
    <TooltipProvider delay={0}>
      <div
        className={cn('flex h-8 items-stretch gap-[2px]', className)}
        role='list'
        aria-label={t('monitoring.uptime.bars')}
      >
        {days.map((day) => (
          <Tooltip key={day.day}>
            <TooltipTrigger
              render={
                <span
                  role='listitem'
                  tabIndex={0}
                  className={cn(
                    'min-w-[2px] flex-1 rounded-[2px] opacity-85 transition-opacity hover:opacity-100 focus-visible:outline-2',
                    DOT_CLASS[dayTone(day)],
                    !day.total && 'opacity-30',
                  )}
                />
              }
            />
            <TooltipContent>
              <div className='font-medium'>
                {formatDay(day.day, i18n.language)}
              </div>
              {day.total ? (
                <div className='text-xs'>
                  {t('monitoring.uptime.dayDetail', {
                    uptime: formatUptime(day.uptime, i18n.language),
                    total: day.total,
                    down: day.down,
                    latency: formatLatency(
                      day.avgLatencyMs === null
                        ? null
                        : Math.round(day.avgLatencyMs),
                    ),
                  })}
                </div>
              ) : (
                <div className='text-xs'>{t('monitoring.uptime.noData')}</div>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

/** What a page shows when its data could not be read, with a way to try again. */
export function LoadError({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const forbidden = error instanceof ApiClientError && error.status === 403;
  const notFound = error instanceof ApiClientError && error.status === 404;
  return (
    <Alert variant='destructive'>
      <CircleAlertIcon />
      {/* The translated title is the message; the server's own words, often English, stay in the tooltip. */}
      <AlertTitle
        title={
          error instanceof Error && !forbidden && !notFound
            ? error.message
            : undefined
        }
      >
        {forbidden
          ? t('monitoring.errors.forbidden')
          : notFound
            ? t('monitoring.errors.notFound')
            : t('monitoring.errors.load')}
      </AlertTitle>
      {onRetry && !forbidden && !notFound ? (
        <Button
          variant='outline'
          size='sm'
          className='mt-2 w-fit'
          onClick={onRetry}
        >
          {t('monitoring.actions.retry')}
        </Button>
      ) : null}
    </Alert>
  );
}

/** A label and value pair in a detail grid. */
export function Fact({
  label,
  children,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className='min-w-0'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='mt-1 truncate text-sm'>{children}</dd>
    </div>
  );
}
