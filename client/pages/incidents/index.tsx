import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon, PlusIcon } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#components/ui/empty';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#components/ui/field';
import { Input } from '#components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Skeleton } from '#components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';
import { Textarea } from '#components/ui/textarea';

import { useApiData } from '../../hooks/use-api-data.js';
import {
  formatDateTime,
  formatDuration,
  INCIDENT_SEVERITIES,
  type Incident,
  type IncidentSeverity,
  type List,
  type Service,
} from '../../lib/monitoring.js';
import {
  IncidentStatusBadge,
  LoadError,
  SeverityBadge,
} from '../monitoring/components.js';
import { errorText, fieldErrorsOf, useCanManage } from '../monitoring/utils.js';
import { SwitchField } from '../monitors/monitor-form.js';

export interface IncidentsOutletContext {
  readonly reload: () => void;
}

const STATES = ['open', 'resolved', 'all'] as const;
const PAGE_SIZE = 20;

export default function IncidentsPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const canManage = useCanManage();
  const [state, setState] = useState<(typeof STATES)[number]>('open');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(0);
  const incidents = useApiData<List<Incident>>(
    'incidents',
    { state, page, pageSize: PAGE_SIZE },
    { refreshMs: 15000 },
  );
  const services = useApiData<List<Service>>('services');
  const serviceName = new Map(
    (services.data?.data ?? []).map((service) => [service.id, service.name]),
  );
  const total = incidents.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageContainer className='mx-auto max-w-6xl'>
        <PageHeader
          title={t('monitoring.incidents.title')}
          description={t('monitoring.incidents.description')}
          actions={
            canManage ? (
              <Button
                onClick={() => setCreating((count) => count + 1)}
                disabled={!services.data?.data.length}
              >
                <PlusIcon data-icon='inline-start' />
                {t('monitoring.incidents.declare')}
              </Button>
            ) : null
          }
        />
        <Tabs
          value={state}
          onValueChange={(value) => {
            setState(value as (typeof STATES)[number]);
            setPage(1);
          }}
        >
          <TabsList>
            {STATES.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`monitoring.incidents.state.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {incidents.error && !incidents.data ? (
          <LoadError error={incidents.error} onRetry={incidents.reload} />
        ) : null}

        {!incidents.data && incidents.loading ? (
          <Skeleton className='h-64 rounded-xl' />
        ) : incidents.data && !incidents.data.data.length ? (
          <Empty className='border'>
            <EmptyHeader>
              <EmptyTitle>
                {state === 'open'
                  ? t('monitoring.incidents.noneOpen')
                  : t('monitoring.incidents.none')}
              </EmptyTitle>
              <EmptyDescription>
                {t('monitoring.incidents.noneHint')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className='divide-y rounded-xl border'>
            {incidents.data?.data.map((incident) => (
              <li key={incident.id}>
                <Link
                  to={incident.id}
                  className='block p-4 transition-colors hover:bg-muted/60'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <IncidentStatusBadge status={incident.status} />
                    <SeverityBadge severity={incident.severity} />
                    <span className='font-medium'>{incident.title}</span>
                    <span className='ml-auto text-xs text-muted-foreground'>
                      {serviceName.get(incident.serviceId)} ·{' '}
                      {formatDateTime(incident.startedAt, i18n.language)} ·{' '}
                      {formatDuration(incident.startedAt, incident.resolvedAt)}
                    </span>
                  </div>
                  {incident.aiSummary || incident.aiState !== 'none' ? (
                    <p className='mt-2 flex items-start gap-1.5 text-sm text-muted-foreground'>
                      <BotIcon className='mt-0.5 size-4 shrink-0' />
                      <span className='line-clamp-2'>
                        {incident.aiSummary ??
                          t(`monitoring.ai.state.${incident.aiState}`)}
                      </span>
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {pages > 1 ? (
          <div className='flex items-center justify-end gap-2 text-sm'>
            <span className='text-muted-foreground'>
              {t('monitoring.common.pageOf', { page, pages })}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('monitoring.common.previous')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t('monitoring.common.next')}
            </Button>
          </div>
        ) : null}
      </PageContainer>

      {creating ? (
        <DeclareIncidentDialog
          key={creating}
          services={services.data?.data ?? []}
          onClose={() => setCreating(0)}
          onSaved={incidents.reload}
        />
      ) : null}

      <Outlet
        context={{ reload: incidents.reload } satisfies IncidentsOutletContext}
      />
    </>
  );
}

/** Opens an incident by hand, for a problem the probes cannot see. */
function DeclareIncidentDialog({
  services,
  onClose,
  onSaved,
}: {
  readonly services: readonly Service[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('major');
  const [body, setBody] = useState('');
  const [publicVisible, setPublicVisible] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const serviceItems = services.map((service) => ({
    value: service.id,
    label: service.name,
  }));
  const severityItems = INCIDENT_SEVERITIES.map((value) => ({
    value,
    label: t(`monitoring.severity.${value}`),
  }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.request({
        path: 'incidents',
        method: 'POST',
        json: { serviceId, title, severity, body, publicVisible },
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.incidents.declared'),
      });
      onSaved();
      onClose();
    } catch (error) {
      const fields = fieldErrorsOf(error);
      setErrors(fields);
      if (!Object.keys(fields).length)
        toaster.show({
          type: 'error',
          title: errorText(error, t('monitoring.errors.save')),
        });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <form onSubmit={(event) => void submit(event)} className='space-y-6'>
          <DialogHeader>
            <DialogTitle>{t('monitoring.incidents.declare')}</DialogTitle>
            <DialogDescription>
              {t('monitoring.incidents.declareDescription')}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-service`}>
                {t('monitoring.fields.service')}
              </FieldLabel>
              <Select
                items={serviceItems}
                value={serviceId}
                onValueChange={(value: string | null) =>
                  value && setServiceId(value)
                }
              >
                <SelectTrigger id={`${id}-service`} className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {serviceItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field data-invalid={Boolean(errors.title)}>
              <FieldLabel htmlFor={`${id}-title`}>
                {t('monitoring.fields.title')}
              </FieldLabel>
              <Input
                id={`${id}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              {errors.title ? <FieldError>{errors.title}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-severity`}>
                {t('monitoring.fields.severity')}
              </FieldLabel>
              <Select
                items={severityItems}
                value={severity}
                onValueChange={(value: IncidentSeverity | null) =>
                  value && setSeverity(value)
                }
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
            <Field data-invalid={Boolean(errors.body)}>
              <FieldLabel htmlFor={`${id}-body`}>
                {t('monitoring.incidents.firstUpdate')}
              </FieldLabel>
              <Textarea
                id={`${id}-body`}
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
              {errors.body ? <FieldError>{errors.body}</FieldError> : null}
            </Field>
            <SwitchField
              id={`${id}-public`}
              label={t('monitoring.fields.publicVisible')}
              description={t('monitoring.incidents.publicHint')}
              checked={publicVisible}
              onChange={setPublicVisible}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              {t('monitoring.actions.cancel')}
            </Button>
            <Button type='submit' disabled={busy || !serviceId}>
              {busy
                ? t('monitoring.actions.saving')
                : t('monitoring.incidents.declare')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
