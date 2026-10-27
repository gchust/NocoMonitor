import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { GitBranchIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Skeleton } from '#components/ui/skeleton';
import { Textarea } from '#components/ui/textarea';

import { useApiData } from '../../hooks/use-api-data.js';
import type {
  List,
  Monitor,
  RemediationAction,
  Service,
} from '../../lib/monitoring.js';
import { RemediationActionsEditor } from './remediation-actions.js';
import { LoadError, StatusDot } from '../monitoring/components.js';
import { errorText, fieldErrorsOf, useCanManage } from '../monitoring/utils.js';

/** The products being watched. A service groups monitors and carries what an agent needs to investigate it. */
export default function ServicesPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const canManage = useCanManage();
  const services = useApiData<List<Service>>('services');
  const monitors = useApiData<List<Monitor>>('monitors');
  const [editing, setEditing] = useState<{ key: number; service?: Service }>();

  const remove = async (service: Service): Promise<void> => {
    if (
      !window.confirm(
        t('monitoring.services.deleteConfirm', { name: service.name }),
      )
    )
      return;
    try {
      await api.request({
        path: `services/${encodeURIComponent(service.id)}`,
        method: 'DELETE',
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.services.deleted'),
      });
      services.reload();
    } catch (error) {
      toaster.show({
        type: 'error',
        title: errorText(error, t('monitoring.errors.save')),
      });
    }
  };

  return (
    <PageContainer className='mx-auto max-w-6xl'>
      <PageHeader
        title={t('monitoring.services.title')}
        description={t('monitoring.services.description')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing({ key: Date.now() })}>
              <PlusIcon data-icon='inline-start' />
              {t('monitoring.services.add')}
            </Button>
          ) : null
        }
      />
      {services.error && !services.data ? (
        <LoadError error={services.error} onRetry={services.reload} />
      ) : null}
      {!services.data && services.loading ? (
        <Skeleton className='h-48 rounded-xl' />
      ) : services.data && !services.data.data.length ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{t('monitoring.overview.noServices')}</EmptyTitle>
            <EmptyDescription>
              {t('monitoring.overview.noServicesHint')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {services.data?.data.map((service) => {
            const owned =
              monitors.data?.data.filter(
                (monitor) => monitor.serviceId === service.id,
              ) ?? [];
            return (
              <Card key={service.id}>
                <CardHeader>
                  <CardTitle>{service.name}</CardTitle>
                  <CardDescription>
                    {service.description ?? service.slug}
                  </CardDescription>
                  {canManage ? (
                    <CardAction className='flex gap-1'>
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('monitoring.actions.edit')}
                        onClick={() => setEditing({ key: Date.now(), service })}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('monitoring.actions.delete')}
                        disabled={owned.length > 0}
                        title={
                          owned.length
                            ? t('monitoring.services.hasMonitors')
                            : undefined
                        }
                        onClick={() => void remove(service)}
                      >
                        <Trash2Icon />
                      </Button>
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent className='space-y-3 text-sm'>
                  {service.repoUrl ? (
                    <a
                      href={service.repoUrl}
                      target='_blank'
                      rel='noreferrer'
                      className='inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline'
                    >
                      <GitBranchIcon className='size-4' />
                      {service.repoUrl.replace(/^https?:\/\//, '')}
                    </a>
                  ) : null}
                  <ul className='flex flex-wrap gap-x-4 gap-y-1'>
                    {owned.map((monitor) => (
                      <li
                        key={monitor.id}
                        className='flex items-center gap-1.5'
                      >
                        <StatusDot status={monitor.status} />
                        {monitor.name}
                      </li>
                    ))}
                  </ul>
                  {service.runbook ? (
                    <p className='line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground'>
                      {service.runbook}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {editing ? (
        <ServiceFormDialog
          key={editing.key}
          service={editing.service}
          onClose={() => setEditing(undefined)}
          onSaved={services.reload}
        />
      ) : null}
    </PageContainer>
  );
}

function ServiceFormDialog({
  service,
  onClose,
  onSaved,
}: {
  readonly service?: Service;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const [draft, setDraft] = useState({
    name: service?.name ?? '',
    slug: service?.slug ?? '',
    description: service?.description ?? '',
    groupName: service?.groupName ?? '',
    repoUrl: service?.repoUrl ?? '',
    runbook: service?.runbook ?? '',
  });
  const [actions, setActions] = useState<RemediationAction[]>(
    service?.remediations ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof draft, value: string): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const json = {
      name: draft.name,
      slug: draft.slug,
      description: draft.description.trim() || null,
      groupName: draft.groupName.trim() || null,
      repoUrl: draft.repoUrl.trim() || null,
      runbook: draft.runbook.trim() || null,
      remediations: actions.length ? actions : null,
    };
    try {
      await api.request(
        service
          ? {
              path: `services/${encodeURIComponent(service.id)}`,
              method: 'PATCH',
              json,
            }
          : { path: 'services', method: 'POST', json },
      );
      toaster.show({
        type: 'success',
        title: t('monitoring.services.saved', { name: draft.name }),
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

  const input = (
    key: keyof typeof draft,
    label: string,
    description?: string,
  ) => (
    <Field data-invalid={Boolean(errors[key])}>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        value={draft[key]}
        onChange={(event) => set(key, event.target.value)}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {errors[key] ? <FieldError>{errors[key]}</FieldError> : null}
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <form onSubmit={(event) => void submit(event)} className='space-y-6'>
          <DialogHeader>
            <DialogTitle>
              {service
                ? t('monitoring.services.edit')
                : t('monitoring.services.add')}
            </DialogTitle>
            <DialogDescription>
              {t('monitoring.services.formDescription')}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {input('name', t('monitoring.fields.name'))}
            {input(
              'slug',
              t('monitoring.fields.slug'),
              t('monitoring.services.slugHint'),
            )}
            {input('description', t('monitoring.fields.description'))}
            {input('groupName', t('monitoring.fields.group'))}
            {input(
              'repoUrl',
              t('monitoring.fields.repoUrl'),
              t('monitoring.services.repoHint'),
            )}
            <Field data-invalid={Boolean(errors.runbook)}>
              <FieldLabel htmlFor={`${id}-runbook`}>
                {t('monitoring.fields.runbook')}
              </FieldLabel>
              <Textarea
                id={`${id}-runbook`}
                rows={5}
                value={draft.runbook}
                onChange={(event) => set('runbook', event.target.value)}
              />
              <FieldDescription>
                {t('monitoring.services.runbookHint')}
              </FieldDescription>
            </Field>
            <RemediationActionsEditor
              actions={actions}
              onChange={setActions}
              error={errors.remediations}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              {t('monitoring.actions.cancel')}
            </Button>
            <Button type='submit' disabled={busy}>
              {busy
                ? t('monitoring.actions.saving')
                : t('monitoring.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
