import { useTranslation } from '@nocobase/i18n/client';
import {
  CheckIcon,
  HandIcon,
  MinusIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';

import { Spinner } from '#components/ui/spinner';
import { cn } from 'cn';

import type { PipelineStep, PipelineStepState } from './pipeline-steps.js';

const STATE_CLASS: Record<PipelineStepState, string> = {
  done: 'border-(--status-success)/30 bg-(--status-success-background) text-(--status-success)',
  active: 'border-primary/30 bg-primary/8 text-primary',
  waiting:
    'border-(--status-warning)/30 bg-(--status-warning-background) text-(--status-warning)',
  failed: 'border-destructive/30 bg-destructive/8 text-destructive',
  skipped: 'border-border bg-muted text-muted-foreground',
  pending: 'border-border bg-background text-muted-foreground',
};

const DOT_CLASS: Record<PipelineStepState, string> = {
  done: 'bg-(--status-success)',
  active: 'bg-primary',
  waiting: 'bg-(--status-warning)',
  failed: 'bg-destructive',
  skipped: 'bg-muted-foreground/40',
  pending: 'bg-border',
};

const STATE_ICON: Partial<Record<PipelineStepState, LucideIcon>> = {
  done: CheckIcon,
  waiting: HandIcon,
  failed: XIcon,
  skipped: MinusIcon,
};

/** The four steps in a row (a column on narrow screens), each with its state in words. */
export function AiPipeline({
  steps,
}: {
  readonly steps: readonly PipelineStep[];
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ol className='grid gap-4 md:grid-cols-4 md:gap-3'>
      {steps.map((step, index) => {
        const Icon = STATE_ICON[step.state];
        return (
          <li key={step.key} className='flex gap-3 md:flex-col md:gap-2'>
            <div className='flex items-center gap-2'>
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                  STATE_CLASS[step.state],
                )}
              >
                {step.state === 'active' ? (
                  <Spinner className='size-4' />
                ) : Icon ? (
                  <Icon className='size-4' />
                ) : (
                  index + 1
                )}
              </span>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden
                  className='hidden h-px flex-1 bg-border md:block'
                />
              ) : null}
            </div>
            <div className='min-w-0'>
              <p className='text-sm font-medium'>
                {t(`monitoring.pipeline.steps.${step.key}`)}
                <span className='sr-only'>
                  {' — '}
                  {t(`monitoring.pipeline.state.${step.state}`)}
                </span>
              </p>
              <p
                className={cn(
                  'text-xs',
                  step.state === 'waiting'
                    ? 'font-medium text-(--status-warning)'
                    : step.state === 'failed'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                )}
              >
                {step.text}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The four steps as a line of dots, for a card: the dots are an aid, the step that needs attention (or the last one
 * reached) is named in words beside them, and the whole line is labelled for screen readers.
 */
export function AiPipelineCompact({
  steps,
  className,
}: {
  readonly steps: readonly PipelineStep[];
  readonly className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const current =
    steps.find((step) => step.state === 'waiting' || step.state === 'failed') ??
    steps.find((step) => step.state === 'active') ??
    [...steps].reverse().find((step) => step.state === 'done') ??
    steps[0];
  const label = t('monitoring.pipeline.label', {
    steps: steps
      .map(
        (step) =>
          `${t(`monitoring.pipeline.steps.${step.key}`)} ${t(`monitoring.pipeline.state.${step.state}`)}`,
      )
      .join(', '),
  });
  return (
    <div
      role='img'
      aria-label={label}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs',
        className,
      )}
    >
      <span className='flex items-center gap-1.5'>
        {steps.map((step, index) => (
          <span key={step.key} className='flex items-center gap-1.5'>
            <span
              className={cn(
                'size-2 rounded-full',
                DOT_CLASS[step.state],
                step.state === 'active' && 'animate-pulse',
              )}
            />
            <span
              className={cn(
                step.key === current.key
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {t(`monitoring.pipeline.steps.${step.key}`)}
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden className='h-px w-3 bg-border' />
            ) : null}
          </span>
        ))}
      </span>
      <span
        className={cn(
          current.state === 'waiting'
            ? 'font-medium text-(--status-warning)'
            : current.state === 'failed'
              ? 'text-destructive'
              : 'text-muted-foreground',
        )}
      >
        {current.text}
      </span>
    </div>
  );
}
