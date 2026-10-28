import { useTranslation } from '@nocobase/i18n/client';
import {
  CheckIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  RocketIcon,
} from 'lucide-react';
import { useId, type ReactElement, type Ref } from 'react';
import { Link } from 'react-router';

import { Button } from '#components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Skeleton } from '#components/ui/skeleton';
import { cn } from 'cn';

import {
  formatDuration,
  type AiBriefing,
  type DrillStatus,
} from '../../lib/monitoring.js';
import { AiPipeline, AiPipelineCompact } from '../monitoring/ai-pipeline.js';
import { useDrillAction } from '../monitoring/drill-dialog.js';
import {
  startSteps,
  useDrillSteps,
  type StartStep,
} from './get-started-state.js';

const STEP_LINKS = {
  agent: { to: '/ai', state: undefined },
  monitor: { to: '/monitors', state: { askAi: true } },
} as const;

/**
 * Getting started, for people who manage monitoring: connect an agent, monitor something of their own, run a drill.
 * Each step is done when the application has it, not when someone ticks it. A running drill shows its automatic
 * response here, live, until it is ended.
 */
export function GetStartedCard({
  ref,
  agent,
  ownMonitors,
  drill,
  onHide,
  onChanged,
  onEnded,
}: {
  readonly ref?: Ref<HTMLDivElement>;
  readonly agent: AiBriefing['agent'] | undefined;
  readonly ownMonitors: number;
  readonly drill: DrillStatus;
  readonly onHide: () => void;
  readonly onChanged: () => void;
  /** Ending a drill can remove this card with the button that was focused: the page then takes focus. */
  readonly onEnded: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { busy, ask, dialog } = useDrillAction({
    onDone: (kind) => {
      if (kind === 'end') onEnded();
    },
    onSettled: onChanged,
  });
  const steps = startSteps({ agent, ownMonitors, drill });
  const done = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done)?.key;
  const running = drill.state !== 'idle';
  const titleId = useId();

  return (
    <Card
      ref={ref}
      role='region'
      tabIndex={-1}
      aria-labelledby={titleId}
      className='outline-none'
    >
      <CardHeader>
        <CardTitle id={titleId} className='flex items-center gap-2'>
          <RocketIcon className='size-4 text-primary' />
          {t('monitoring.start.title')}
        </CardTitle>
        <CardDescription>
          {t('monitoring.start.description')}{' '}
          <span className='whitespace-nowrap'>
            · {t('monitoring.start.progress', { done, total: steps.length })}
          </span>
        </CardDescription>
        <CardAction>
          <Button variant='ghost' size='sm' onClick={onHide}>
            {t('monitoring.start.hide')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <ol className='grid gap-3 md:grid-cols-3'>
          {steps.map((step, index) => (
            <StartStepItem
              key={step.key}
              step={step}
              index={index}
              primary={step.key === next && !running}
              agentOffline={
                step.key === 'agent' &&
                Boolean(agent?.configured) &&
                agent?.online === false
              }
              drillRunning={running}
              busy={busy}
              onStartDrill={() => ask('start')}
            />
          ))}
        </ol>
        {running ? (
          <DrillPanel
            drill={drill}
            agentReady={Boolean(agent?.configured && agent.online)}
            busy={busy}
            onEnd={() => ask('end')}
          />
        ) : null}
      </CardContent>

      {dialog}
    </Card>
  );
}

function StartStepItem({
  step,
  index,
  primary,
  agentOffline,
  drillRunning,
  busy,
  onStartDrill,
}: {
  readonly step: StartStep;
  readonly index: number;
  readonly primary: boolean;
  readonly agentOffline: boolean;
  readonly drillRunning: boolean;
  readonly busy: boolean;
  readonly onStartDrill: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const s = (key: string): string =>
    t(`monitoring.start.steps.${step.key}.${key}`);
  const variant = primary ? 'default' : 'outline';
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        step.done && 'bg-muted/40',
      )}
    >
      <div className='flex items-start gap-3'>
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
            step.done
              ? 'bg-(--status-success-background) text-(--status-success)'
              : 'bg-primary/10 text-primary',
          )}
        >
          {step.done ? <CheckIcon className='size-3.5' /> : index + 1}
        </span>
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>{s('title')}</p>
          <p className='mt-1 text-xs leading-5 text-muted-foreground'>
            {agentOffline ? s('offline') : s('description')}
          </p>
        </div>
      </div>
      <div className='mt-auto'>
        {step.done ? (
          <p className='text-xs text-(--status-success)'>
            <span className='sr-only'>{s('title')}: </span>
            {t('monitoring.start.done')}
          </p>
        ) : step.key === 'drill' ? (
          drillRunning ? null : (
            <Button
              size='sm'
              variant={variant}
              disabled={busy}
              onClick={onStartDrill}
            >
              <FlaskConicalIcon data-icon='inline-start' />
              {s('action')}
            </Button>
          )
        ) : (
          <Button
            size='sm'
            variant={variant}
            nativeButton={false}
            render={
              <Link
                to={STEP_LINKS[step.key].to}
                state={STEP_LINKS[step.key].state}
              />
            }
          >
            {s('action')}
          </Button>
        )}
      </div>
    </li>
  );
}

function DrillPanel({
  drill,
  agentReady,
  busy,
  onEnd,
}: {
  readonly drill: DrillStatus;
  readonly agentReady: boolean;
  readonly busy: boolean;
  readonly onEnd: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const steps = useDrillSteps(drill, agentReady);
  const since = (from: string | null, to: string | null): string =>
    from && to ? formatDuration(from, to, i18n.language) : '';
  const recovered = drill.state === 'recovered';

  let note: string | null = null;
  if (drill.targetUnreachable)
    note = t('monitoring.drill.unreachable', { url: drill.targetUrl ?? '' });
  else if (drill.detectedAt && !drill.diagnosedAt && !agentReady && !drill.fix)
    note = t('monitoring.drill.noAgent');
  else if (drill.fix?.status === 'pending')
    note = t('monitoring.drill.approveHint', { action: drill.fix.actionTitle });

  return (
    <section
      aria-labelledby='drill-title'
      className='flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <FlaskConicalIcon className='size-4 text-primary' />
        <h3 id='drill-title' className='font-medium'>
          {t(
            recovered
              ? 'monitoring.drill.recovered'
              : 'monitoring.drill.running',
          )}
        </h3>
        {recovered ? (
          <p className='text-sm text-muted-foreground'>
            {drill.diagnosedAt
              ? t('monitoring.drill.summary', {
                  detect: since(drill.startedAt, drill.detectedAt),
                  diagnose: since(drill.detectedAt, drill.diagnosedAt),
                  recover: since(drill.startedAt, drill.recoveredAt),
                })
              : t('monitoring.drill.summaryNoDiagnosis', {
                  detect: since(drill.startedAt, drill.detectedAt),
                  recover: since(drill.startedAt, drill.recoveredAt),
                })}
          </p>
        ) : null}
      </div>
      <AiPipeline steps={steps} />
      {note ? (
        <p
          className={cn(
            'flex items-start gap-2 text-sm',
            drill.targetUnreachable
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          <CircleAlertIcon className='mt-0.5 size-4 shrink-0' />
          <span className='min-w-0 break-words'>{note}</span>
        </p>
      ) : null}
      <div className='flex flex-wrap gap-2'>
        {drill.incidentId ? (
          <Button
            size='sm'
            variant={recovered ? 'outline' : 'default'}
            nativeButton={false}
            render={<Link to={`incident/${drill.incidentId}`} />}
          >
            {t('monitoring.drill.openIncident')}
          </Button>
        ) : null}
        <Button
          size='sm'
          variant={recovered ? 'default' : 'ghost'}
          disabled={busy}
          onClick={onEnd}
        >
          {t(
            recovered ? 'monitoring.drill.endAndClean' : 'monitoring.drill.end',
          )}
        </Button>
      </div>
    </section>
  );
}

/** Where Getting started will be, while what it counts is read. */
export function GetStartedSkeleton(): ReactElement {
  const { t } = useTranslation();
  return (
    <Card role='status' aria-label={t('monitoring.common.loading')}>
      <CardHeader>
        <Skeleton className='h-5 w-56' />
        <Skeleton className='h-4 w-full max-w-md' />
      </CardHeader>
      <CardContent>
        <div className='grid gap-3 md:grid-cols-3'>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className='h-28 rounded-xl' />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** A running drill, once Getting started is hidden: where it stands, and the way back to the full card. */
export function DrillBanner({
  ref,
  drill,
  onShow,
}: {
  readonly ref?: Ref<HTMLButtonElement>;
  readonly drill: DrillStatus;
  readonly onShow: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const steps = useDrillSteps(drill, true);
  return (
    <section
      aria-label={t('monitoring.drill.running')}
      className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm'
    >
      <span className='flex items-center gap-2 font-medium'>
        <FlaskConicalIcon className='size-4 text-primary' />
        {t(
          drill.state === 'recovered'
            ? 'monitoring.drill.recovered'
            : 'monitoring.drill.running',
        )}
      </span>
      <AiPipelineCompact steps={steps} />
      <Button
        ref={ref}
        size='sm'
        variant='outline'
        className='ml-auto'
        onClick={onShow}
      >
        {t('monitoring.drill.show')}
      </Button>
    </section>
  );
}
