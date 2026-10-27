import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  BotIcon,
  CircleCheckIcon,
  InfoIcon,
  MegaphoneIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react';
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { RouteChildPage } from '#components/route-child-page';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Field, FieldGroup, FieldLabel } from '#components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Skeleton } from '#components/ui/skeleton';
import { Spinner } from '#components/ui/spinner';
import { Textarea } from '#components/ui/textarea';
import { cn } from 'cn';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatDateTime,
  formatDuration,
  INCIDENT_STATUSES,
  type Incident,
  type IncidentStatus,
  type IncidentUpdate,
  type Monitor,
  type Service,
} from '../../lib/monitoring.js';
import {
  Fact,
  IncidentStatusBadge,
  LoadError,
  MonitorStatusBadge,
  SeverityBadge,
} from '../monitoring/components.js';
import { errorText, useCanManage } from '../monitoring/utils.js';
import { SwitchField } from '../monitors/monitor-form.js';
import type { IncidentsOutletContext } from './index.js';

interface IncidentDetail {
  incident: Incident;
  service: Service | null;
  monitor: Monitor | null;
  updates: IncidentUpdate[];
}

export interface SuggestedAction {
  title?: string;
  description?: string;
  risk?: string;
  command?: string;
}

export default function IncidentDetailPage(): ReactElement {
  const { incidentId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const parent = useOutletContext<IncidentsOutletContext>();
  const canManage = useCanManage();
  const path = `incidents/${encodeURIComponent(incidentId)}`;
  const detail = useApiData<{ data: IncidentDetail }>(path, undefined, {
    refreshMs: 10000,
  });
  const data = detail.data?.data;
  const incident = data?.incident;

  const reload = (): void => {
    detail.reload();
    parent.reload();
  };

  return (
    <RouteChildPage>
      <PageContainer className='mx-auto max-w-6xl'>
        <BackButton />
        {detail.error && !data ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : null}
        {!data && detail.loading ? (
          <Skeleton className='h-64 rounded-xl' />
        ) : null}
        {incident && data ? (
          <>
            <header className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <IncidentStatusBadge status={incident.status} />
                <SeverityBadge severity={incident.severity} />
                <StatusBadge tone='neutral'>
                  {t(`monitoring.incidents.source.${incident.source}`)}
                </StatusBadge>
                {incident.publicVisible ? (
                  <StatusBadge tone='info'>
                    {t('monitoring.incidents.public')}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone='neutral'>
                    {t('monitoring.incidents.internal')}
                  </StatusBadge>
                )}
              </div>
              <h1 className='font-heading text-2xl font-semibold tracking-[-0.035em]'>
                {incident.title}
              </h1>
            </header>

            <dl className='grid grid-cols-2 gap-4 rounded-xl border p-4 md:grid-cols-4'>
              <Fact label={t('monitoring.fields.service')}>
                {data.service?.name ?? '—'}
              </Fact>
              <Fact label={t('monitoring.fields.monitor')}>
                {data.monitor ? (
                  <Link
                    to={`/monitors/${data.monitor.id}`}
                    className='inline-flex items-center gap-2 hover:underline'
                  >
                    {data.monitor.name}
                    <MonitorStatusBadge status={data.monitor.status} />
                  </Link>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label={t('monitoring.incidents.started')}>
                {formatDateTime(incident.startedAt, i18n.language)}
              </Fact>
              <Fact label={t('monitoring.incidents.duration')}>
                {formatDuration(incident.startedAt, incident.resolvedAt)}
                {incident.resolvedAt
                  ? ''
                  : ` · ${t('monitoring.incidents.ongoing')}`}
              </Fact>
            </dl>

            <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]'>
              <div className='space-y-6'>
                <AiPanel incident={incident} />
                <Timeline updates={data.updates} />
              </div>
              {canManage ? (
                <aside className='space-y-6'>
                  <PostUpdate
                    incident={incident}
                    path={path}
                    onSaved={reload}
                  />
                  <IncidentSettings
                    incident={incident}
                    path={path}
                    onSaved={reload}
                  />
                </aside>
              ) : null}
            </div>
          </>
        ) : null}
      </PageContainer>
    </RouteChildPage>
  );
}

/** What the diagnosis agent concluded, or where it is with its work. */
function AiPanel({ incident }: { readonly incident: Incident }): ReactElement {
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
        <CardTitle className='flex items-center gap-2'>
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
        </CardTitle>
        <CardDescription>
          {incident.aiUpdatedAt
            ? t('monitoring.ai.updated', {
                when: formatDateTime(incident.aiUpdatedAt, i18n.language),
              })
            : t(`monitoring.ai.state.${incident.aiState}`)}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        {incident.aiSummary ? (
          <p className='leading-6'>{incident.aiSummary}</p>
        ) : null}
        {incident.aiRootCause ? (
          <div>
            <h3 className='mb-1 font-medium'>{t('monitoring.ai.rootCause')}</h3>
            <p className='leading-6 whitespace-pre-wrap text-muted-foreground'>
              {incident.aiRootCause}
            </p>
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
                        {t('monitoring.ai.risk', { level: action.risk })}
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
      </CardContent>
    </Card>
  );
}

const UPDATE_ICON = {
  status: MegaphoneIcon,
  note: InfoIcon,
  diagnosis: BotIcon,
  remediation: WrenchIcon,
  system: CircleCheckIcon,
};

function Timeline({
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
              <p className='mt-1 text-sm leading-6 whitespace-pre-wrap'>
                {update.body}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PostUpdate({
  incident,
  path,
  onSaved,
}: {
  readonly incident: Incident;
  readonly path: string;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<IncidentStatus | 'keep'>('keep');
  const [publicVisible, setPublicVisible] = useState(incident.publicVisible);
  const [busy, setBusy] = useState(false);
  const statusItems = [
    { value: 'keep', label: t('monitoring.incidents.keepStatus') },
    ...INCIDENT_STATUSES.filter((value) => value !== incident.status).map(
      (value) => ({
        value,
        label: t(`monitoring.incidentStatus.${value}`),
      }),
    ),
  ];

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.request({
        path: `${path}/updates`,
        method: 'POST',
        json: { body, publicVisible, ...(status === 'keep' ? {} : { status }) },
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.incidents.posted'),
      });
      setBody('');
      setStatus('keep');
      onSaved();
    } catch (error) {
      toaster.show({
        type: 'error',
        title: errorText(error, t('monitoring.errors.save')),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('monitoring.incidents.postUpdate')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void submit(event)} className='space-y-4'>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-status`}>
                {t('monitoring.fields.status')}
              </FieldLabel>
              <Select
                items={statusItems}
                value={status}
                onValueChange={(value: string | null) =>
                  value && setStatus(value as IncidentStatus | 'keep')
                }
              >
                <SelectTrigger id={`${id}-status`} className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-body`}>
                {t('monitoring.incidents.message')}
              </FieldLabel>
              <Textarea
                id={`${id}-body`}
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            <SwitchField
              id={`${id}-public`}
              label={t('monitoring.fields.publicVisible')}
              checked={publicVisible}
              onChange={setPublicVisible}
            />
          </FieldGroup>
          <Button
            type='submit'
            className='w-full'
            disabled={busy || !body.trim()}
          >
            {busy
              ? t('monitoring.actions.saving')
              : t('monitoring.incidents.post')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function IncidentSettings({
  incident,
  path,
  onSaved,
}: {
  readonly incident: Incident;
  readonly path: string;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const patch = async (json: Record<string, unknown>): Promise<void> => {
    try {
      await api.request({ path, method: 'PATCH', json });
      onSaved();
    } catch (error) {
      toaster.show({
        type: 'error',
        title: errorText(error, t('monitoring.errors.save')),
      });
    }
  };
  const severityItems = (['minor', 'major', 'critical'] as const).map(
    (value) => ({
      value,
      label: t(`monitoring.severity.${value}`),
    }),
  );
  return (
    <Card size='sm'>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-severity`}>
              {t('monitoring.fields.severity')}
            </FieldLabel>
            <Select
              items={severityItems}
              value={incident.severity}
              onValueChange={(value: string | null) => {
                if (value) void patch({ severity: value });
              }}
            >
              <SelectTrigger id={`${id}-severity`} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {severityItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <SwitchField
            id={`${id}-public`}
            label={t('monitoring.incidents.showOnStatusPage')}
            checked={incident.publicVisible}
            onChange={(checked) => void patch({ publicVisible: checked })}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
