import { useTranslation } from '@nocobase/i18n/client';
import { ChevronRightIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

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
} from '../../lib/monitoring.js';

/**
 * The steps the agent took, as the server classified them (never its commands or their output): open and refreshed
 * every few seconds while it works, folded with a count and the time it took once it is done.
 */
export function InvestigationSteps({
  incident,
}: {
  readonly incident: Incident;
}): ReactElement | null {
  const { t, i18n } = useTranslation();
  const working =
    incident.aiState === 'queued' || incident.aiState === 'running';
  const activity = useApiData<{ data: InvestigationActivity }>(
    `incidents/${encodeURIComponent(incident.id)}/aiActivity`,
    // A new run or a new state reads the steps again at once.
    { run: incident.aiRunId ?? undefined, state: incident.aiState },
    { refreshMs: working ? 3000 : undefined },
  );
  // Open while the agent works and folded once it is done, unless the reader chose.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? working;
  const data = activity.data?.data;
  const steps = data?.steps ?? [];

  if (activity.error && !data)
    return (
      <p className='text-xs text-muted-foreground'>
        {t('monitoring.ai.activity.unavailable')}
      </p>
    );
  if (!data) return null;

  const time = (value: string): string =>
    new Date(value).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  const summary = working
    ? t('monitoring.ai.activity.summaryRunning', { count: steps.length })
    : data.startedAt && data.finishedAt
      ? t('monitoring.ai.activity.summary', {
          count: steps.length,
          duration: formatDuration(
            data.startedAt,
            data.finishedAt,
            i18n.language,
          ),
        })
      : null;

  return (
    <Collapsible open={open} onOpenChange={setChosen} className='border-t pt-3'>
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
        {steps.length || working ? (
          <ol className='mt-2 ml-2 flex flex-col gap-2 border-l pl-4'>
            {steps.map((step) => (
              <li key={step.seq} className='flex gap-3'>
                <time
                  dateTime={step.at}
                  className='w-20 shrink-0 text-xs leading-5 text-muted-foreground tabular-nums'
                >
                  {time(step.at)}
                </time>
                <span>{t(`monitoring.ai.activity.kind.${step.kind}`)}</span>
              </li>
            ))}
            {working ? (
              <li className='flex items-center gap-3 text-muted-foreground'>
                <span className='flex w-20 shrink-0'>
                  <Spinner className='size-4' />
                </span>
                {t(`monitoring.ai.state.${incident.aiState}`)}
              </li>
            ) : null}
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
