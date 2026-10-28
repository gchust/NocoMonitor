import { useTranslation } from '@nocobase/i18n/client';
import { CheckIcon, GlobeIcon, LightbulbIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Label } from '#components/ui/label';
import { Spinner } from '#components/ui/spinner';
import { cn } from 'cn';

import type { ProposedMonitor, SetupProposal } from '../../lib/monitoring.js';

export interface ApplyChoice {
  monitors: number[];
  statusPage: boolean;
}

/**
 * - `active`: the latest proposal, which the person may apply;
 * - `waiting`: the latest, while the agent works on a newer message (or the reader may not apply it);
 * - `replaced`: one the conversation moved on from, told in one line;
 * - `applied`: the one applied, with only what was created.
 */
export type ProposalMode = 'active' | 'waiting' | 'replaced' | 'applied';

/**
 * What the agent proposes, grouped by service: each monitor with what it checks and why, and the status page. Everything
 * starts chosen; the person leaves out what they do not want and creates the rest.
 */
export function ProposalCard({
  proposal,
  mode,
  created,
  applying,
  onApply,
}: {
  readonly proposal: SetupProposal;
  readonly mode: ProposalMode;
  /** What applying it created, for `applied`. */
  readonly created?: ApplyChoice | null;
  readonly applying: boolean;
  readonly onApply: (choice: ApplyChoice) => void;
}): ReactElement {
  const { t } = useTranslation();
  const active = mode === 'active';
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(() => new Set());
  const [withPage, setWithPage] = useState(true);
  const chosen = proposal.monitors
    .map((_, index) => index)
    .filter((index) => !skipped.has(index));
  const page = proposal.statusPage;
  const count = chosen.length + (page && withPage ? 1 : 0);
  const serviceName = new Map(
    proposal.services.map((service) => [service.key, service.name]),
  );
  const shown = (index: number) =>
    mode !== 'applied' || Boolean(created?.monitors.includes(index));
  const groups = proposal.services
    .map((service) => ({
      service,
      monitors: proposal.monitors
        .map((monitor, index) => ({ monitor, index }))
        .filter(
          ({ monitor, index }) =>
            monitor.service === service.key && shown(index),
        ),
    }))
    .filter((group) => group.monitors.length);
  const showPage = page && (mode !== 'applied' || created?.statusPage);

  if (mode === 'replaced')
    return (
      <p className='text-xs text-muted-foreground'>
        {t('monitoring.setup.proposal.replacedSummary', {
          count: proposal.monitors.length,
        })}
        {page
          ? `${t('monitoring.setup.proposal.listSeparator')}${page.title}`
          : null}
      </p>
    );

  // Each monitor and the status page: a checkbox while it may be chosen, a check once it was created.
  const pick = (
    id: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
  ) =>
    mode === 'applied' ? (
      <CheckIcon className='mt-0.5 size-4 shrink-0 text-(--status-success)' />
    ) : (
      <Checkbox
        id={id}
        className='mt-0.5'
        checked={checked}
        disabled={!active || applying}
        onCheckedChange={onChange}
      />
    );

  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-lg border bg-card p-4',
        mode === 'waiting' && 'opacity-70',
      )}
      aria-label={t('monitoring.setup.proposal.title')}
    >
      <h3 className='font-medium'>
        {t(
          mode === 'applied'
            ? 'monitoring.setup.proposal.created'
            : 'monitoring.setup.proposal.title',
        )}
      </h3>

      {groups.map(({ service, monitors }) => (
        <div key={service.key} className='flex flex-col gap-2'>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='font-medium'>{service.name}</span>
            <Badge variant={service.existingId ? 'outline' : 'secondary'}>
              {t(
                service.existingId
                  ? 'monitoring.setup.proposal.existingService'
                  : 'monitoring.setup.proposal.newService',
              )}
            </Badge>
          </div>
          <ul className='flex flex-col divide-y rounded-md border'>
            {monitors.map(({ monitor, index }) => (
              <li key={index} className='flex gap-3 p-3'>
                {pick(`proposal-monitor-${index}`, !skipped.has(index), (on) =>
                  setSkipped((current) => {
                    const next = new Set(current);
                    if (on) next.delete(index);
                    else next.add(index);
                    return next;
                  }),
                )}
                <div className='flex min-w-0 flex-1 flex-col gap-1'>
                  <Label
                    htmlFor={`proposal-monitor-${index}`}
                    className='font-medium'
                  >
                    {monitor.name}
                  </Label>
                  <p className='font-mono text-xs break-all text-muted-foreground'>
                    {monitor.method} {monitor.url}
                  </p>
                  <p className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
                    <span>{checkText(monitor, t)}</span>
                    <span>
                      {t('monitoring.setup.proposal.every', {
                        count: monitor.intervalSec,
                      })}
                    </span>
                    {monitor.degradedLatencyMs ? (
                      <span>
                        {t('monitoring.setup.proposal.slowAfter', {
                          ms: monitor.degradedLatencyMs,
                        })}
                      </span>
                    ) : null}
                    {monitor.autoDiagnose ? (
                      <span>{t('monitoring.setup.proposal.autoDiagnose')}</span>
                    ) : null}
                  </p>
                  {monitor.note ? (
                    <p className='flex gap-1.5 text-xs'>
                      <LightbulbIcon className='mt-px size-3.5 shrink-0 text-primary' />
                      <span>{monitor.note}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {page && showPage ? (
        <div className='flex gap-3 rounded-md border p-3'>
          {pick('proposal-status-page', withPage, setWithPage)}
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <Label
              htmlFor='proposal-status-page'
              className='flex items-center gap-1.5 font-medium'
            >
              <GlobeIcon className='size-4 text-muted-foreground' />
              {page.title}
            </Label>
            <p className='font-mono text-xs break-all text-muted-foreground'>
              /status/{page.slug}
            </p>
            {page.description ? (
              <p className='text-xs'>{page.description}</p>
            ) : null}
            <p className='text-xs text-muted-foreground'>
              {t('monitoring.setup.proposal.pageServices', {
                services: page.services
                  .map((key) => serviceName.get(key) ?? key)
                  .join(t('monitoring.setup.proposal.listSeparator')),
              })}
            </p>
          </div>
        </div>
      ) : null}

      {active ? (
        <div className='flex flex-wrap items-center justify-end gap-3'>
          <p className='mr-auto text-xs text-muted-foreground'>
            {t('monitoring.setup.proposal.hint')}
          </p>
          <Button
            onClick={() => onApply({ monitors: chosen, statusPage: withPage })}
            disabled={!count || applying}
          >
            {applying ? <Spinner data-icon='inline-start' /> : null}
            {t('monitoring.setup.proposal.apply', { count })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function checkText(
  monitor: ProposedMonitor,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (monitor.type === 'keyword')
    return t('monitoring.setup.proposal.check.keyword', {
      keyword: monitor.keyword,
    });
  if (monitor.type === 'json')
    return monitor.jsonExpected === null
      ? t('monitoring.setup.proposal.check.jsonPresent', {
          path: monitor.jsonPath,
        })
      : t('monitoring.setup.proposal.check.json', {
          path: monitor.jsonPath,
          expected: monitor.jsonExpected,
        });
  return t('monitoring.setup.proposal.check.http', {
    status: monitor.expectedStatus,
  });
}
