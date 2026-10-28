import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import {
  BellRingIcon,
  RadioTowerIcon,
  SendIcon,
  TriangleAlertIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { useId, useMemo, useState, type ReactElement } from 'react';

import { DataTable } from '#components/data-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RecordLink } from '#components/record-link';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Checkbox } from '#components/ui/checkbox';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '#components/ui/combobox';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import { FieldGroup } from '#components/ui/field';
import { Label } from '#components/ui/label';
import { Skeleton } from '#components/ui/skeleton';
import { Spinner } from '#components/ui/spinner';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  ALERT_EVENTS,
  formatDateTime,
  type AlertDelivery,
  type AlertDeliveryStatus,
  type AlertEvent,
  type AlertRecipient,
  type AlertSettingsView,
} from '../../lib/monitoring.js';
import { LoadError } from '../monitoring/components.js';
import { useCanManage } from '../monitoring/utils.js';
import { SwitchField } from '../monitors/monitor-form.js';

const TONE: Record<
  AlertDeliveryStatus,
  'success' | 'info' | 'warning' | 'neutral'
> = {
  delivered: 'success',
  pending: 'info',
  partial: 'warning',
  failed: 'warning',
  unknown: 'neutral',
};

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** A failed write, in the reader's words: the reasons the server names, or a translated fallback. */
function saveErrorText(error: unknown, t: Translate): string {
  const reason = error instanceof ApiClientError ? error.reason : undefined;
  if (reason === 'UNKNOWN_CHANNEL')
    return t('monitoring.alerts.unknownChannel');
  if (reason === 'NOT_INSTALLED') return t('monitoring.alerts.notInstalled');
  if (reason === 'NO_DESTINATION') return t('monitoring.alerts.noDestination');
  if (error instanceof ApiClientError && error.status === 403)
    return t('monitoring.errors.forbidden');
  return t('monitoring.alerts.saveFailed');
}

/** Who is told about incidents, through which configured channels, and what was sent lately. */
export default function AlertsPage(): ReactElement {
  const { t } = useTranslation();
  const settings = useApiData<{ data: AlertSettingsView }>(
    'monitoringAlerts/settings',
  );
  const deliveries = useApiData<{ data: AlertDelivery[] }>(
    'monitoringAlerts/deliveries',
    undefined,
    { refreshMs: 15000 },
  );
  const saved = settings.data?.data;
  const reload = (): void => {
    settings.reload();
    deliveries.reload();
  };

  return (
    <PageContainer className='mx-auto max-w-5xl'>
      <PageHeader
        title={t('monitoring.alerts.title')}
        description={t('monitoring.alerts.description')}
      />
      {settings.error && !saved ? (
        <LoadError error={settings.error} onRetry={settings.reload} />
      ) : null}
      {saved ? (
        <AlertsForm settings={saved} onSaved={reload} />
      ) : settings.error ? null : (
        <SettingsSkeleton />
      )}
      <Deliveries data={deliveries} />
    </PageContainer>
  );
}

/** Placeholders shaped like the three settings cards. */
function SettingsSkeleton(): ReactElement {
  const { t } = useTranslation();
  const card = (rows: number) => (
    <Card>
      <CardHeader>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-4 w-full max-w-xs' />
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className='h-8' />
        ))}
      </CardContent>
    </Card>
  );
  return (
    <div
      className='flex flex-col gap-6'
      role='status'
      aria-label={t('monitoring.common.loading')}
    >
      <div className='grid gap-6 lg:grid-cols-2'>
        {card(1)}
        {card(1)}
      </div>
      {card(5)}
    </div>
  );
}

/**
 * The three settings cards. Channels and events apply as soon as they are switched; recipients, chosen one by one,
 * are saved together with their own Save, and the test goes to the saved ones.
 */
function AlertsForm({
  settings,
  onSaved,
}: {
  readonly settings: AlertSettingsView;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const canManage = useCanManage();
  const id = useId();
  // What was switched and not yet confirmed by the server: shown at once, undone if the save fails.
  const [pending, setPending] = useState<{
    channels?: string[];
    events?: Record<AlertEvent, boolean>;
  } | null>(null);
  const channels = pending?.channels ?? settings.channels;
  const events = pending?.events ?? settings.events;

  const apply = async (change: {
    channels?: string[];
    events?: Record<AlertEvent, boolean>;
  }): Promise<void> => {
    setPending(change);
    try {
      await api.request({
        path: 'monitoringAlerts/settings',
        method: 'PUT',
        json: {
          recipients: settings.recipients.map((recipient) => recipient.id),
          channels: change.channels ?? settings.channels,
          events: change.events ?? settings.events,
        },
      });
      toaster.show({ type: 'success', title: t('monitoring.alerts.saved') });
      onSaved();
    } catch (error) {
      toaster.show({ type: 'error', title: saveErrorText(error, t) });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className='flex flex-col gap-6'>
      {canManage ? null : (
        <p className='text-sm text-muted-foreground'>
          {t('monitoring.alerts.readOnly')}
        </p>
      )}
      <div className='grid gap-6 lg:grid-cols-2'>
        <RecipientsCard
          // A saved list starts a new draft.
          key={settings.recipients.map((recipient) => recipient.id).join()}
          settings={settings}
          canManage={canManage}
          onSaved={onSaved}
        />

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <RadioTowerIcon className='size-4 text-muted-foreground' />
              {t('monitoring.alerts.channels.title')}
            </CardTitle>
            <CardDescription>
              {t('monitoring.alerts.channels.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {settings.available.length ? (
              <ul className='flex flex-col gap-3'>
                {settings.available.map((channel) => {
                  const checkboxId = `${id}-channel-${channel.name}`;
                  const unsupported = channel.kind === 'unsupported';
                  return (
                    <li key={channel.name} className='flex items-start gap-3'>
                      <Checkbox
                        id={checkboxId}
                        className='mt-0.5'
                        checked={channels.includes(channel.name)}
                        disabled={!canManage || unsupported || pending !== null}
                        onCheckedChange={(checked) =>
                          void apply({
                            channels: checked
                              ? [...channels, channel.name]
                              : channels.filter(
                                  (name) => name !== channel.name,
                                ),
                          })
                        }
                      />
                      <Label
                        htmlFor={checkboxId}
                        className='flex flex-col items-start gap-0.5 font-normal'
                      >
                        <span className='font-medium'>{channel.name}</span>
                        <span className='text-xs text-muted-foreground'>
                          {t(`monitoring.alerts.channels.kind.${channel.kind}`)}{' '}
                          · {channel.type}
                        </span>
                      </Label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty className='min-h-40 border border-dashed p-6 md:p-6'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <RadioTowerIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t('monitoring.alerts.channels.empty')}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t('monitoring.alerts.channels.emptyHint')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <BellRingIcon className='size-4 text-muted-foreground' />
            {t('monitoring.alerts.events.title')}
          </CardTitle>
          <CardDescription>
            {t('monitoring.alerts.events.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {ALERT_EVENTS.map((event: AlertEvent) => (
              <SwitchField
                key={event}
                id={`${id}-${event}`}
                label={t(`monitoring.alerts.events.${event}`)}
                description={t(`monitoring.alerts.events.${event}Hint`)}
                checked={events[event]}
                disabled={!canManage || pending !== null}
                onChange={(checked) =>
                  void apply({ events: { ...events, [event]: checked } })
                }
              />
            ))}
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}

/** The people alerts go to: chosen in a draft, saved with the card's own Save, then tried with a test. */
function RecipientsCard({
  settings,
  canManage,
  onSaved,
}: {
  readonly settings: AlertSettingsView;
  readonly canManage: boolean;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const [recipients, setRecipients] = useState(settings.recipients);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const dirty =
    recipients.map((recipient) => recipient.id).join() !==
    settings.recipients.map((recipient) => recipient.id).join();

  const save = async (): Promise<void> => {
    setBusy('save');
    try {
      await api.request({
        path: 'monitoringAlerts/settings',
        method: 'PUT',
        json: {
          recipients: recipients.map((recipient) => recipient.id),
          channels: settings.channels,
          events: settings.events,
        },
      });
      toaster.show({ type: 'success', title: t('monitoring.alerts.saved') });
      onSaved();
    } catch (error) {
      toaster.show({ type: 'error', title: saveErrorText(error, t) });
    } finally {
      setBusy(null);
    }
  };

  const test = async (): Promise<void> => {
    setBusy('test');
    try {
      const { data } = await api.request<{ data: AlertDelivery }>({
        path: 'monitoringAlerts/test',
        method: 'POST',
        json: {},
      });
      const failing = data.channels
        .filter((channel) => channel.status === 'failed')
        .map((channel) => channel.name);
      toaster.show(
        failing.length
          ? {
              type: 'error',
              title: t('monitoring.alerts.testFailedChannels', {
                channels: failing.join(', '),
              }),
            }
          : data.status === 'failed'
            ? { type: 'error', title: t('monitoring.alerts.testFailed') }
            : { type: 'success', title: t('monitoring.alerts.testSent') },
      );
      onSaved();
    } catch (error) {
      const reason = error instanceof ApiClientError ? error.reason : undefined;
      toaster.show({
        type: 'error',
        title: reason
          ? saveErrorText(error, t)
          : t('monitoring.alerts.testFailed'),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <UsersIcon className='size-4 text-muted-foreground' />
          {t('monitoring.alerts.recipients.title')}
        </CardTitle>
        <CardDescription>
          {t('monitoring.alerts.recipients.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        {canManage ? (
          <RecipientPicker
            id={`${id}-recipients`}
            value={recipients}
            onChange={setRecipients}
          />
        ) : (
          <ul className='flex flex-wrap gap-1.5'>
            {recipients.map((recipient) => (
              <li
                key={recipient.id}
                className='rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium'
              >
                {recipient.name}
              </li>
            ))}
          </ul>
        )}
        {recipients.length ? null : (
          <p className='flex items-center gap-2 text-sm text-(--status-warning)'>
            <TriangleAlertIcon className='size-4 shrink-0' />
            {t('monitoring.alerts.recipients.none')}
          </p>
        )}
      </CardContent>
      {canManage ? (
        <CardFooter className='mt-auto flex-wrap justify-end gap-2'>
          {dirty ? (
            <p className='mr-auto text-xs text-muted-foreground'>
              {t('monitoring.alerts.testNeedsSave')}
            </p>
          ) : null}
          <Button
            variant='outline'
            disabled={busy !== null || dirty}
            onClick={() => void test()}
          >
            {busy === 'test' ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <SendIcon data-icon='inline-start' />
            )}
            {busy === 'test'
              ? t('monitoring.alerts.testing')
              : t('monitoring.alerts.test')}
          </Button>
          <Button
            disabled={busy !== null || !dirty}
            onClick={() => void save()}
          >
            {busy === 'save' ? <Spinner data-icon='inline-start' /> : null}
            {busy === 'save'
              ? t('monitoring.actions.saving')
              : t('monitoring.actions.save')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** People chosen one by one, found by name or email on the server. */
function RecipientPicker({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: readonly AlertRecipient[];
  readonly onChange: (value: AlertRecipient[]) => void;
}): ReactElement {
  const { t } = useTranslation();
  const anchor = useComboboxAnchor();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const found = useApiData<{ data: AlertRecipient[] }>(
    'monitoringAlerts/recipients',
    { q: query },
  );
  const byId = new Map(
    [...value, ...(found.data?.data ?? [])].map((person) => [
      person.id,
      person,
    ]),
  );
  const label = (personId: string): string =>
    byId.get(personId)?.name ?? personId;

  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor={id} className='sr-only'>
        {t('monitoring.alerts.recipients.title')}
      </Label>
      <Combobox
        multiple
        items={[...byId.keys()]}
        itemToStringLabel={label}
        // The server already matched the query; the list shows what it answered.
        filter={null}
        open={open}
        onOpenChange={setOpen}
        value={value.map((person) => person.id)}
        onValueChange={(next: string[]) =>
          onChange(
            next
              .map((personId) => byId.get(personId))
              .filter((person): person is AlertRecipient => Boolean(person)),
          )
        }
        onInputValueChange={(next: string) => setQuery(next)}
      >
        <ComboboxChips ref={anchor}>
          <ComboboxValue>
            {(selected: string[]) =>
              selected.map((personId) => (
                <ComboboxChip key={personId} showRemove={false}>
                  {label(personId)}
                  {/* The primitive's remove button has no name: this one says whom it removes. */}
                  <ComboboxPrimitive.ChipRemove
                    render={<Button variant='ghost' size='icon-xs' />}
                    className='-ml-1 opacity-50 hover:opacity-100'
                    data-slot='combobox-chip-remove'
                    aria-label={t('monitoring.alerts.recipients.remove', {
                      name: label(personId),
                    })}
                  >
                    <XIcon className='pointer-events-none' />
                  </ComboboxPrimitive.ChipRemove>
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxChipsInput
            id={id}
            placeholder={t('monitoring.alerts.recipients.placeholder')}
            onKeyDown={(event) => {
              // Escape closes the list; on a closed list it would clear every chosen person.
              if (event.key === 'Escape' && !open) event.preventBaseUIHandler();
            }}
          />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>
            {t('monitoring.alerts.recipients.empty')}
          </ComboboxEmpty>
          <ComboboxList>
            {(personId: string) => {
              const person = byId.get(personId);
              return (
                <ComboboxItem key={personId} value={personId}>
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate'>{person?.name}</span>
                    <span className='truncate text-xs text-muted-foreground'>
                      {person?.email ??
                        t('monitoring.alerts.recipients.noEmail')}
                    </span>
                  </span>
                </ComboboxItem>
              );
            }}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

function Deliveries({
  data,
}: {
  readonly data: ReturnType<typeof useApiData<{ data: AlertDelivery[] }>>;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const rows = data.data?.data;
  const d = (key: string): string => t(`monitoring.alerts.deliveries.${key}`);
  // A short list in a card: plain headers, no sorting or pagination.
  const columns = useMemo<ColumnDef<AlertDelivery>[]>(
    () => [
      {
        accessorKey: 'at',
        header: t('monitoring.alerts.deliveries.time'),
        cell: ({ row }) => (
          <span className='whitespace-nowrap text-muted-foreground'>
            {formatDateTime(row.original.at, i18n.language)}
          </span>
        ),
      },
      {
        accessorKey: 'title',
        header: t('monitoring.alerts.deliveries.alert'),
        cell: ({ row }) => (
          <div className='max-w-80'>
            <span className='block text-xs text-muted-foreground'>
              {t(`monitoring.alerts.deliveries.event.${row.original.event}`)}
            </span>
            {row.original.incidentId ? (
              <RecordLink
                to={`/incidents/${row.original.incidentId}`}
                className='block truncate'
                title={row.original.title}
              >
                {row.original.title}
              </RecordLink>
            ) : (
              <span
                className='block truncate font-medium'
                title={row.original.title}
              >
                {row.original.title}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'channels',
        header: t('monitoring.alerts.deliveries.channels'),
        cell: ({ row }) => (
          <span className='text-muted-foreground'>
            {row.original.channels.length
              ? row.original.channels
                  .map(
                    (channel) =>
                      `${channel.name} · ${t(`monitoring.alerts.deliveries.state.${channel.status}`)}`,
                  )
                  .join(', ')
              : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('monitoring.alerts.deliveries.status'),
        cell: ({ row }) => (
          <StatusBadge size='sm' tone={TONE[row.original.status]}>
            {t(`monitoring.alerts.deliveries.state.${row.original.status}`)}
          </StatusBadge>
        ),
      },
    ],
    [i18n.language, t],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{d('title')}</CardTitle>
        <CardDescription>{d('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.error && !rows ? (
          <LoadError error={data.error} onRetry={data.reload} />
        ) : !rows ? (
          <div
            className='flex flex-col gap-2'
            role='status'
            aria-label={t('monitoring.common.loading')}
          >
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className='h-10' />
            ))}
          </div>
        ) : rows.length ? (
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(row) => row.key}
            pagination={false}
            showSelectedCount={false}
          />
        ) : (
          <Empty className='min-h-40 border border-dashed p-6 md:p-6'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <BellRingIcon />
              </EmptyMedia>
              <EmptyTitle>{d('empty')}</EmptyTitle>
              <EmptyDescription>{d('emptyHint')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
