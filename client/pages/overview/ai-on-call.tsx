import { useTranslation } from '@nocobase/i18n/client';
import {
  BotIcon,
  CircleCheckBigIcon,
  CircleXIcon,
  HandIcon,
  SparklesIcon,
  WrenchIcon,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';

import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import { Skeleton } from '#components/ui/skeleton';
import { cn } from 'cn';

import type { ApiData } from '../../hooks/use-api-data.js';
import {
  formatDuration,
  formatRelative,
  type AiBriefing,
} from '../../lib/monitoring.js';
import { LoadError } from '../monitoring/components.js';
import { useCanManage } from '../monitoring/utils.js';

/** The window the AI card and the feed look back over, in days. */
export const BRIEFING_DAYS = 7;
/** Where the AI card's "Waiting on you" number leads. */
export const ATTENTION_ID = 'overview-attention';

/**
 * The first thing the overview shows: that an agent is on call, whether it can take work now, and what it did over the
 * last week — what it diagnosed, how fast, the fixes the probes confirmed, and what it left to people.
 */
export function AiOnCallCard({
  briefing,
  canManage,
  secondarySetup = false,
}: {
  readonly briefing: ApiData<{ data: AiBriefing }>;
  readonly canManage: boolean;
  /** Another card on the page leads to the same setup as its primary action. */
  readonly secondarySetup?: boolean;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const data = briefing.data?.data;

  if (!data)
    return (
      <Card className='bg-primary/5 ring-primary/20'>
        <CardContent>
          {briefing.error ? (
            <LoadError error={briefing.error} onRetry={briefing.reload} />
          ) : (
            <div
              className='flex flex-col gap-4'
              role='status'
              aria-label={t('monitoring.common.loading')}
            >
              <Skeleton className='h-6 w-48' />
              <Skeleton className='h-4 w-full max-w-xl' />
              <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className='h-14' />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );

  const { agent, stats } = data;
  const state = !agent.configured
    ? 'notConfigured'
    : agent.online === false
      ? 'offline'
      : !agent.enabled
        ? 'off'
        : 'online';
  const hint = {
    notConfigured: t('monitoring.oncall.notConfiguredHint'),
    offline: t('monitoring.oncall.offlineHint'),
    off: t('monitoring.oncall.offHint'),
    online: t('monitoring.oncall.pitch'),
  }[state];
  // A discovered agent is named after its tool and model (`Claude · claude-sonnet-5-5`): the model only when it is not.
  const agentLine =
    agent.model && !agent.name?.includes(agent.model)
      ? [agent.name, agent.model].filter(Boolean).join(' · ')
      : (agent.name ?? '');

  return (
    <Card className='bg-primary/5 ring-primary/20'>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
          <span className='flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground'>
            <SparklesIcon className='size-4' />
          </span>
          {t(`monitoring.oncall.title.${state}`)}
          {agent.configured && agent.online !== null ? (
            <StatusBadge tone={agent.online ? 'success' : 'warning'} size='sm'>
              {agent.online
                ? t('monitoring.oncall.online')
                : t('monitoring.oncall.offline')}
            </StatusBadge>
          ) : null}
          {agentLine ? (
            <span className='text-sm font-normal text-muted-foreground'>
              {agentLine}
              {agent.busy
                ? ` · ${t('monitoring.oncall.busy', { count: agent.busy })}`
                : ''}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          {hint}
          {state === 'notConfigured' && !canManage
            ? ` ${t('monitoring.oncall.askAdmin')}`
            : ''}
        </CardDescription>
        {state === 'notConfigured' && canManage ? (
          <CardAction>
            <Button
              variant={secondarySetup ? 'outline' : 'default'}
              nativeButton={false}
              render={<Link to='ai' />}
            >
              <SparklesIcon data-icon='inline-start' />
              {t('monitoring.oncall.setUp')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      {agent.configured ? (
        <CardContent>
          <dl className='grid grid-cols-2 gap-x-4 gap-y-4 border-t border-primary/15 pt-4 md:grid-cols-4'>
            <Metric
              label={t('monitoring.oncall.diagnosed')}
              value={t('monitoring.oncall.diagnosedValue', {
                diagnosed: stats.diagnosed,
                total: stats.incidents,
              })}
              hint={
                stats.incidents
                  ? t('monitoring.oncall.diagnosedHint')
                  : t('monitoring.oncall.noIncidents', {
                      count: BRIEFING_DAYS,
                    })
              }
            />
            <Metric
              label={t('monitoring.oncall.timeToDiagnosis')}
              value={
                stats.medianTimeToDiagnosisMs === null
                  ? '—'
                  : formatDuration(
                      new Date(0).toISOString(),
                      new Date(stats.medianTimeToDiagnosisMs).toISOString(),
                      i18n.language,
                    )
              }
              hint={t('monitoring.oncall.timeHint')}
            />
            <Metric
              label={t('monitoring.oncall.fixesVerified')}
              value={t('monitoring.oncall.fixesValue', {
                verified: stats.fixesVerified,
                requested: stats.fixesRequested,
              })}
              hint={t('monitoring.oncall.fixesHint')}
            />
            <Metric
              label={t('monitoring.oncall.waiting')}
              value={
                stats.needsYou ? (
                  <a
                    href={`#${ATTENTION_ID}`}
                    className='text-(--status-warning) underline-offset-4 hover:underline'
                    onClick={(event) => {
                      // The overview scrolls inside the shell, not the window: move there and hand it the focus.
                      event.preventDefault();
                      const target = document.getElementById(ATTENTION_ID);
                      target?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                      target?.focus({ preventScroll: true });
                    }}
                  >
                    {stats.needsYou}
                  </a>
                ) : (
                  '0'
                )
              }
              hint={t('monitoring.oncall.waitingHint')}
            />
          </dl>
        </CardContent>
      ) : null}
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint: string;
}): ReactElement {
  return (
    <div className='min-w-0'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='font-heading text-2xl font-semibold tracking-tight tabular-nums'>
        {value}
      </dd>
      <dd className='text-xs text-muted-foreground'>{hint}</dd>
    </div>
  );
}

/**
 * Fix approvals and failed diagnoses of open incidents: what the agent left to people. The briefing lists the newest
 * ten; past that, the footer says how many there are and leads to the open incidents.
 */
export function AttentionCard({
  items,
  total,
}: {
  readonly items: AiBriefing['needsYou'];
  readonly total: number;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const canDecide = useCanManage();
  return (
    <Card
      id={ATTENTION_ID}
      tabIndex={-1}
      className='scroll-mt-4 ring-(--status-warning)/30 outline-none'
    >
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <HandIcon className='size-4 text-(--status-warning)' />
          {t('monitoring.oncall.attention.title')}
        </CardTitle>
        <CardDescription>
          {t('monitoring.oncall.attention.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='-mx-2 flex flex-col'>
          {items.map((item) => (
            <li key={`${item.kind}-${item.incidentId}-${item.at}`}>
              <Link
                to={`incident/${item.incidentId}`}
                className='flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted'
              >
                {item.kind === 'approval' ? (
                  <HandIcon className='mt-0.5 size-4 shrink-0 text-(--status-warning)' />
                ) : (
                  <CircleXIcon className='mt-0.5 size-4 shrink-0 text-destructive' />
                )}
                <span className='min-w-0 flex-1'>
                  <span className='block font-medium'>
                    {item.kind === 'approval'
                      ? t(
                          canDecide
                            ? 'monitoring.oncall.attention.approval'
                            : 'monitoring.oncall.attention.approvalOthers',
                          {
                            action: item.actionTitle,
                          },
                        )
                      : t('monitoring.oncall.attention.failed')}
                  </span>
                  <span className='block truncate text-xs text-muted-foreground'>
                    {item.incidentTitle}
                  </span>
                </span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {formatRelative(item.at, i18n.language)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
      {total > items.length ? (
        <CardFooter className='border-t'>
          <Button
            variant='ghost'
            size='sm'
            nativeButton={false}
            render={<Link to='incidents' />}
          >
            {t('monitoring.oncall.attention.more', {
              shown: items.length,
              count: total,
            })}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** Shown in place of the incident lists when nothing is open and nothing waits on people. */
export function AllClearCard(): ReactElement {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className='flex items-center gap-3'>
        <CircleCheckBigIcon className='size-5 shrink-0 text-(--status-success)' />
        <div>
          <p className='font-medium'>{t('monitoring.oncall.allClear.title')}</p>
          <p className='text-muted-foreground'>
            {t('monitoring.oncall.allClear.description')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** The latest diagnoses and fix updates, newest first: what the agent has been doing. */
export function AgentFeedCard({
  briefing,
}: {
  readonly briefing: ApiData<{ data: AiBriefing }>;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const feed = briefing.data?.data.feed;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <BotIcon className='size-4 text-primary' />
          {t('monitoring.oncall.feed.title')}
        </CardTitle>
        <CardDescription>
          {t('monitoring.oncall.feed.description', { count: BRIEFING_DAYS })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!feed ? (
          briefing.error ? (
            <p className='text-sm text-muted-foreground'>
              {t('monitoring.errors.load')}
            </p>
          ) : (
            <div
              className='flex flex-col gap-3'
              role='status'
              aria-label={t('monitoring.common.loading')}
            >
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} className='h-10' />
              ))}
            </div>
          )
        ) : !feed.length ? (
          <Empty className='min-h-40 border border-dashed p-6 md:p-6'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <BotIcon />
              </EmptyMedia>
              <EmptyTitle>{t('monitoring.oncall.feed.empty')}</EmptyTitle>
              <EmptyDescription>
                {t('monitoring.oncall.feed.emptyHint')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className='relative flex flex-col gap-4 border-l pl-5'>
            {feed.map((item) => {
              const Icon = item.kind === 'diagnosis' ? BotIcon : WrenchIcon;
              return (
                <li key={item.id} className='relative'>
                  <span
                    className={cn(
                      'absolute top-0 -left-8 flex size-6 items-center justify-center rounded-full border bg-background',
                      item.authorType === 'agent' &&
                        'border-primary/40 text-primary',
                    )}
                  >
                    <Icon className='size-3.5' />
                  </span>
                  <Link
                    to={`incident/${item.incidentId}`}
                    className='group block'
                  >
                    <span className='flex items-center gap-2 text-xs text-muted-foreground'>
                      <span className='font-medium text-foreground'>
                        {t(`monitoring.oncall.feed.kind.${item.kind}`)}
                      </span>
                      <span>{formatRelative(item.at, i18n.language)}</span>
                    </span>
                    <span className='mt-0.5 line-clamp-1 underline-offset-4 group-hover:underline'>
                      {item.text}
                    </span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {item.incidentTitle}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
      {feed?.length ? (
        <CardFooter className='border-t'>
          <Button
            variant='ghost'
            size='sm'
            nativeButton={false}
            render={<Link to='incidents' />}
          >
            {t('monitoring.oncall.feed.viewAll')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
