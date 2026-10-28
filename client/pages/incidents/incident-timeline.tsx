import { useTranslation } from '@nocobase/i18n/client';
import {
  BotIcon,
  CircleCheckIcon,
  InfoIcon,
  MegaphoneIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';

import { LongText } from '#components/long-text';
import { StatusBadge } from '#components/status-badge';
import { cn } from 'cn';

import { formatDateTime, type IncidentUpdate } from '../../lib/monitoring.js';
import { IncidentStatusBadge } from '../monitoring/components.js';

const UPDATE_ICON = {
  status: MegaphoneIcon,
  note: InfoIcon,
  diagnosis: BotIcon,
  remediation: WrenchIcon,
  system: CircleCheckIcon,
};

/** What happened to the incident, newest first, from people, agents and the system. */
export function IncidentTimeline({
  updates,
}: {
  readonly updates: readonly IncidentUpdate[];
}): ReactElement {
  const { t, i18n } = useTranslation();
  const ordered = [...updates].reverse();
  return (
    <section aria-labelledby='incident-timeline' className='space-y-3'>
      <h2 id='incident-timeline' className='text-base font-medium'>
        {t('monitoring.incidents.timeline')}
      </h2>
      <ol className='relative space-y-5 border-l pl-6'>
        {ordered.map((update) => {
          const Icon =
            update.authorType === 'user' ? UserIcon : UPDATE_ICON[update.kind];
          return (
            <li key={update.id} className='relative'>
              <span
                className={cn(
                  'absolute top-0.5 -left-[2.15rem] flex size-6 items-center justify-center rounded-full border bg-background',
                  update.authorType === 'agent' &&
                    'border-primary/40 text-primary',
                )}
              >
                <Icon className='size-3.5' />
              </span>
              <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                {update.status ? (
                  <IncidentStatusBadge status={update.status} />
                ) : null}
                <span className='font-medium text-foreground'>
                  {update.authorName ??
                    t(`monitoring.incidents.author.${update.authorType}`)}
                </span>
                <span>{formatDateTime(update.createdAt, i18n.language)}</span>
                {update.publicVisible ? (
                  <StatusBadge tone='info' size='sm'>
                    {t('monitoring.incidents.public')}
                  </StatusBadge>
                ) : null}
              </div>
              <LongText className='mt-1 text-sm'>{update.body}</LongText>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
