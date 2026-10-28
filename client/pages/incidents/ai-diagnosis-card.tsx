import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon, SparklesIcon, WrenchIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { LongText } from '#components/long-text';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Spinner } from '#components/ui/spinner';

import { formatDateTime, type Incident } from '../../lib/monitoring.js';
import { InvestigationSteps } from './investigation-steps.js';
import type { Diagnose } from './use-diagnose.js';

export interface SuggestedAction {
  title?: string;
  description?: string;
  risk?: string;
  command?: string;
}

/** What the diagnosis agent concluded, or where it is with its work. */
export function AiDiagnosisCard({
  incident,
  canManage,
  diagnosis,
}: {
  readonly incident: Incident;
  readonly canManage: boolean;
  readonly diagnosis: Diagnose;
}): ReactElement {
  const { diagnose, asking } = diagnosis;
  const { t, i18n } = useTranslation();
  const working =
    incident.aiState === 'queued' || incident.aiState === 'running';
  const actions = (incident.aiSuggestedActions ?? []).filter(
    (action): action is SuggestedAction =>
      Boolean(action) && typeof action === 'object',
  );
  return (
    <Card className='ring-primary/20'>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          <BotIcon className='size-5 text-primary' />
          {t('monitoring.ai.title')}
          {working ? <Spinner className='size-4' /> : null}
          {incident.aiConfidence ? (
            <StatusBadge tone='info' size='sm'>
              {t('monitoring.ai.confidence', {
                level: t(`monitoring.ai.level.${incident.aiConfidence}`, {
                  defaultValue: incident.aiConfidence,
                }),
              })}
            </StatusBadge>
          ) : null}
          {incident.aiVerdict ? (
            <StatusBadge
              tone={incident.aiVerdict === 'outage' ? 'warning' : 'success'}
              size='sm'
            >
              {t(`monitoring.ai.verdict.${incident.aiVerdict}`)}
            </StatusBadge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {incident.aiUpdatedAt
            ? t('monitoring.ai.updated', {
                when: formatDateTime(incident.aiUpdatedAt, i18n.language),
              })
            : t(`monitoring.ai.state.${incident.aiState}`)}
        </CardDescription>
        {canManage ? (
          <CardAction>
            <Button
              size='sm'
              variant='outline'
              disabled={asking || working}
              onClick={() => void diagnose()}
            >
              {asking ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <SparklesIcon data-icon='inline-start' />
              )}
              {incident.aiState === 'none'
                ? t('monitoring.ai.diagnose')
                : t('monitoring.ai.diagnoseAgain')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        {incident.aiSummary ? (
          <p className='text-base leading-7 font-medium break-words'>
            {incident.aiSummary}
          </p>
        ) : null}
        {incident.aiRootCause ? (
          <div>
            <h3 className='mb-1 font-medium'>{t('monitoring.ai.evidence')}</h3>
            <LongText className='text-muted-foreground'>
              <Evidence text={incident.aiRootCause} />
            </LongText>
          </div>
        ) : null}
        {actions.length ? (
          <div>
            <h3 className='mb-2 font-medium'>
              {t('monitoring.ai.suggestedActions')}
            </h3>
            <ol className='space-y-2'>
              {actions.map((action, index) => (
                <li
                  key={JSON.stringify(action)}
                  className='rounded-lg border p-3'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <WrenchIcon className='size-4 text-muted-foreground' />
                    <span className='font-medium'>
                      {action.title ??
                        t('monitoring.ai.step', { index: index + 1 })}
                    </span>
                    {action.risk ? (
                      <StatusBadge
                        tone={action.risk === 'low' ? 'success' : 'warning'}
                        size='sm'
                      >
                        {t('monitoring.ai.risk', {
                          level: t(`monitoring.ai.level.${action.risk}`, {
                            defaultValue: action.risk,
                          }),
                        })}
                      </StatusBadge>
                    ) : null}
                  </div>
                  {action.description ? (
                    <p className='mt-1 text-muted-foreground'>
                      {action.description}
                    </p>
                  ) : null}
                  {action.command ? (
                    <pre className='mt-2 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs'>
                      {action.command}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {!incident.aiSummary && !working ? (
          <p className='text-muted-foreground'>{t('monitoring.ai.noneYet')}</p>
        ) : null}
        {incident.aiRunId ? <InvestigationSteps incident={incident} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * The evidence of a diagnosis. Agents are asked for one line per piece of evidence, each starting with "- "; a list
 * when they did that, the text as written when they did not (diagnoses recorded before the instruction).
 */
function Evidence({ text }: { readonly text: string }): ReactElement {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const bullet = /^[-*•]\s+/;
  if (lines.length < 2 || !lines.every((line) => bullet.test(line)))
    return <>{text}</>;
  return (
    <ul className='list-disc space-y-1 pl-5 whitespace-normal'>
      {lines.map((line, index) => (
        // Lines are text without identity; the same line can appear twice.
        // eslint-disable-next-line @eslint-react/no-array-index-key
        <li key={index}>{line.replace(bullet, '')}</li>
      ))}
    </ul>
  );
}
