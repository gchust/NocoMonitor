import { useTranslation } from '@nocobase/i18n/client';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { useEffect, useEffectEvent, useState, type ReactElement } from 'react';

import { Button } from '#components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#components/ui/collapsible';
import { Spinner } from '#components/ui/spinner';
import { cn } from 'cn';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatDuration,
  type Incident,
  type InvestigationActivity,
  type InvestigationStep,
} from '../../lib/monitoring.js';

/** How often the steps are read again while the agent works: a step takes it seconds, so this reads as live. */
const LIVE_REFRESH_MS = 2000;

const isWorking = (incident: Pick<Incident, 'aiState'>): boolean =>
  incident.aiState === 'queued' || incident.aiState === 'running';

/** The steps of the incident's latest diagnosis run, read again every two seconds while the agent works. */
function useInvestigationActivity(
  incident: Pick<Incident, 'id' | 'aiRunId' | 'aiState'>,
  enabled = true,
) {
  const working = isWorking(incident);
  return useApiData<{ data: InvestigationActivity }>(
    enabled ? `incidents/${encodeURIComponent(incident.id)}/aiActivity` : null,
    // A new run or a new state reads the steps again at once.
    { run: incident.aiRunId ?? undefined, state: incident.aiState },
    { refreshMs: working && enabled ? LIVE_REFRESH_MS : undefined },
  );
}

/**
 * The steps the agent took, as the server classified them (never its commands or their output). While it works they
 * are the card's lead: what it is doing now, for how long, and what it already did. Once it is done they fold into a
 * log with a count and the time it took.
 */
export function InvestigationSteps({
  incident,
  onSettled,
}: {
  readonly incident: Incident;
  /** The steps show the run finished before the incident does: the page reads the incident again. */
  readonly onSettled?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const working = isWorking(incident);
  const activity = useInvestigationActivity(incident);
  const data = activity.data?.data;
  const settled =
    working && data !== undefined && !isWorking({ aiState: data.status });
  const announceSettled = useEffectEvent(() => onSettled?.());
  useEffect(() => {
    if (settled) announceSettled();
  }, [settled]);

  if (activity.error && !data)
    return (
      <p className='text-xs text-muted-foreground'>
        {t('monitoring.ai.activity.unavailable')}
      </p>
    );
  if (working) return <LiveInvestigation incident={incident} data={data} />;
  if (!data) return null;
  return <InvestigationLog data={data} />;
}

/** What the agent is doing right now, in one line: for an incident card that has no room for the steps. */
export function CurrentStep({
  incident,
  className,
}: {
  readonly incident: Incident;
  readonly className?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const working = isWorking(incident);
  const activity = useInvestigationActivity(incident, working);
  if (!working) return null;
  const current = activity.data?.data.steps.at(-1);
  return (
    <p
      className={cn('flex min-w-0 items-center gap-1.5 text-sm', className)}
      aria-live='polite'
    >
      <Spinner className='size-4 shrink-0 text-primary' />
      <span className='min-w-0 truncate'>
        {current ? (
          <>
            {t(`monitoring.ai.activity.now.${current.kind}`)}
            <StepTargets step={current} className='ml-1.5' />
          </>
        ) : (
          t(`monitoring.ai.state.${incident.aiState}`)
        )}
      </span>
    </p>
  );
}

function LiveInvestigation({
  incident,
  data,
}: {
  readonly incident: Incident;
  readonly data: InvestigationActivity | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const steps = data?.steps ?? [];
  const done = steps.slice(0, -1);
  const current = steps.at(-1);
  const startedAt = data?.startedAt ?? null;
  const now = useNow(startedAt !== null);

  return (
    <section className='rounded-lg border border-primary/25 bg-primary/5 p-4'>
      <h3 className='flex flex-wrap items-center gap-2 font-medium'>
        <span className='relative flex size-2.5'>
          <span className='absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60' />
          <span className='relative inline-flex size-2.5 rounded-full bg-primary' />
        </span>
        {t('monitoring.ai.activity.live')}
        {startedAt ? (
          <span className='font-normal text-muted-foreground tabular-nums'>
            ·{' '}
            {t('monitoring.ai.activity.elapsed', {
              duration: clock(now - new Date(startedAt).getTime()),
            })}
          </span>
        ) : null}
      </h3>
      <ol className='mt-3 flex flex-col gap-2'>
        {done.map((step) => (
          <li
            key={step.seq}
            className='flex items-start gap-2 text-muted-foreground'
          >
            <CheckIcon className='mt-0.5 size-4 shrink-0 text-(--status-success)' />
            <span className='min-w-0'>
              {t(`monitoring.ai.activity.kind.${step.kind}`)}
              <StepTargets step={step} className='ml-1.5' />
            </span>
          </li>
        ))}
        <li className='flex items-start gap-2 font-medium' aria-live='polite'>
          <Spinner className='mt-0.5 size-4 shrink-0 text-primary' />
          <span className='min-w-0'>
            {incident.aiState === 'queued' ? (
              t('monitoring.ai.activity.queued')
            ) : current ? (
              <>
                {t(`monitoring.ai.activity.now.${current.kind}`)}
                <StepTargets step={current} className='ml-1.5' />
              </>
            ) : (
              t('monitoring.ai.activity.starting')
            )}
          </span>
        </li>
      </ol>
    </section>
  );
}

function InvestigationLog({
  data,
}: {
  readonly data: InvestigationActivity;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const steps = data.steps;

  const time = (value: string): string =>
    new Date(value).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  const summary =
    data.startedAt && data.finishedAt
      ? t('monitoring.ai.activity.summary', {
          count: steps.length,
          duration: formatDuration(
            data.startedAt,
            data.finishedAt,
            i18n.language,
          ),
        })
      : // The run may go on after the diagnosis is recorded, asking for a fix: it has no end yet.
        t('monitoring.ai.activity.count', { count: steps.length });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='border-t pt-3'>
      <CollapsibleTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='-ml-2 h-auto gap-2 px-2 py-1 font-medium'
          />
        }
      >
        <ChevronRightIcon
          className={cn('size-4 transition-transform', open && 'rotate-90')}
        />
        {t('monitoring.ai.activity.title')}
        {summary ? (
          <span className='font-normal text-muted-foreground'>· {summary}</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {steps.length ? (
          <ol className='mt-2 ml-2 flex flex-col gap-2 border-l pl-4'>
            {steps.map((step) => (
              <li key={step.seq} className='flex gap-3'>
                <time
                  dateTime={step.at}
                  className='w-20 shrink-0 text-xs leading-5 text-muted-foreground tabular-nums'
                >
                  {time(step.at)}
                </time>
                <span className='min-w-0'>
                  {t(`monitoring.ai.activity.kind.${step.kind}`)}
                  <StepTargets step={step} className='block' />
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className='mt-2 text-xs text-muted-foreground'>
            {t('monitoring.ai.activity.empty')}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** What a step looked at: addresses and files, in a monospace line that wraps anywhere. */
function StepTargets({
  step,
  className,
}: {
  readonly step: InvestigationStep;
  readonly className?: string;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!step.targets.length) return null;
  return (
    <span
      className={cn(
        'font-mono text-xs font-normal break-all text-muted-foreground',
        className,
      )}
    >
      {step.targets.join(', ')}
      {step.more
        ? ` ${t('monitoring.ai.activity.more', { count: step.more })}`
        : ''}
    </span>
  );
}

/** A duration that counts up, as a clock reads it: 0:42, 12:05, 1:02:05. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const two = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours
    ? `${hours}:${two(minutes)}:${two(seconds % 60)}`
    : `${minutes}:${two(seconds % 60)}`;
}

/** The time now, read again every second while `enabled`: for a duration that counts up. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}
