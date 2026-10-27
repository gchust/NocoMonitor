import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { useHref } from 'react-router';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
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
import { Checkbox } from '#components/ui/checkbox';
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
  FieldLegend,
  FieldSet,
} from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Skeleton } from '#components/ui/skeleton';

import { useApiData } from '../../hooks/use-api-data.js';
import type { List, Service, StatusPage } from '../../lib/monitoring.js';
import { LoadError } from '../monitoring/components.js';
import { errorText, fieldErrorsOf, useCanManage } from '../monitoring/utils.js';
import { SwitchField } from '../monitors/monitor-form.js';

/** The public pages customers read, and which services each one shows. */
export default function StatusPagesPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const canManage = useCanManage();
  const pages = useApiData<List<StatusPage>>('statusPages');
  const services = useApiData<List<Service>>('services');
  const serviceName = new Map(
    (services.data?.data ?? []).map((service) => [service.id, service.name]),
  );
  const [editing, setEditing] = useState<{ key: number; page?: StatusPage }>();

  const remove = async (page: StatusPage): Promise<void> => {
    if (
      !window.confirm(
        t('monitoring.statusPages.deleteConfirm', { title: page.title }),
      )
    )
      return;
    try {
      await api.request({
        path: `statusPages/${encodeURIComponent(page.id)}`,
        method: 'DELETE',
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.statusPages.deleted'),
      });
      pages.reload();
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
        title={t('monitoring.statusPages.title')}
        description={t('monitoring.statusPages.description')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing({ key: Date.now() })}>
              <PlusIcon data-icon='inline-start' />
              {t('monitoring.statusPages.add')}
            </Button>
          ) : null
        }
      />
      {pages.error && !pages.data ? (
        <LoadError error={pages.error} onRetry={pages.reload} />
      ) : null}
      {!pages.data && pages.loading ? (
        <Skeleton className='h-40 rounded-xl' />
      ) : pages.data && !pages.data.data.length ? (
        <Empty className='border'>
          <EmptyHeader>
            <EmptyTitle>{t('monitoring.statusPages.empty')}</EmptyTitle>
            <EmptyDescription>
              {t('monitoring.statusPages.emptyHint')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          {pages.data?.data.map((page) => (
            <StatusPageCard
              key={page.id}
              page={page}
              serviceNames={page.serviceIds.map(
                (id) => serviceName.get(id) ?? id,
              )}
              canManage={canManage}
              onEdit={() => setEditing({ key: Date.now(), page })}
              onDelete={() => void remove(page)}
            />
          ))}
        </div>
      )}
      {editing ? (
        <StatusPageFormDialog
          key={editing.key}
          page={editing.page}
          services={services.data?.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={pages.reload}
        />
      ) : null}
    </PageContainer>
  );
}

function StatusPageCard({
  page,
  serviceNames,
  canManage,
  onEdit,
  onDelete,
}: {
  readonly page: StatusPage;
  readonly serviceNames: readonly string[];
  readonly canManage: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const href = useHref(`/status/${page.slug}`);
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {page.title}
          {page.published ? (
            <StatusBadge tone='success' size='sm'>
              {t('monitoring.statusPages.published')}
            </StatusBadge>
          ) : (
            <StatusBadge size='sm'>
              {t('monitoring.statusPages.draft')}
            </StatusBadge>
          )}
        </CardTitle>
        <CardDescription>/status/{page.slug}</CardDescription>
        <CardAction className='flex gap-1'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('monitoring.statusPages.open')}
            disabled={!page.published}
            nativeButton={false}
            render={<a href={href} target='_blank' rel='noreferrer' />}
          >
            <ExternalLinkIcon />
          </Button>
          {canManage ? (
            <>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('monitoring.actions.edit')}
                onClick={onEdit}
              >
                <PencilIcon />
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('monitoring.actions.delete')}
                onClick={onDelete}
              >
                <Trash2Icon />
              </Button>
            </>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className='space-y-2 text-sm'>
        {page.description ? (
          <p className='text-muted-foreground'>{page.description}</p>
        ) : null}
        <p>
          {serviceNames.join(' · ') || t('monitoring.statusPages.noServices')}
        </p>
      </CardContent>
    </Card>
  );
}

function StatusPageFormDialog({
  page,
  services,
  onClose,
  onSaved,
}: {
  readonly page?: StatusPage;
  readonly services: readonly Service[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [description, setDescription] = useState(page?.description ?? '');
  const [serviceIds, setServiceIds] = useState<string[]>(
    page?.serviceIds ?? services.map((service) => service.id),
  );
  const [published, setPublished] = useState(page?.published ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    const json = {
      title,
      slug,
      description: description.trim() || null,
      serviceIds,
      published,
    };
    try {
      await api.request(
        page
          ? {
              path: `statusPages/${encodeURIComponent(page.id)}`,
              method: 'PATCH',
              json,
            }
          : { path: 'statusPages', method: 'POST', json },
      );
      toaster.show({
        type: 'success',
        title: t('monitoring.statusPages.saved', { title }),
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
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        <form onSubmit={(event) => void submit(event)} className='space-y-6'>
          <DialogHeader>
            <DialogTitle>
              {page
                ? t('monitoring.statusPages.edit')
                : t('monitoring.statusPages.add')}
            </DialogTitle>
            <DialogDescription>
              {t('monitoring.statusPages.formDescription')}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
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
            <Field data-invalid={Boolean(errors.slug)}>
              <FieldLabel htmlFor={`${id}-slug`}>
                {t('monitoring.fields.slug')}
              </FieldLabel>
              <Input
                id={`${id}-slug`}
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
              <FieldDescription>
                {t('monitoring.statusPages.slugHint')}
              </FieldDescription>
              {errors.slug ? <FieldError>{errors.slug}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-description`}>
                {t('monitoring.fields.description')}
              </FieldLabel>
              <Input
                id={`${id}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <FieldSet>
              <FieldLegend variant='label'>
                {t('monitoring.statusPages.services')}
              </FieldLegend>
              <div className='space-y-2'>
                {services.map((service) => (
                  <Label
                    key={service.id}
                    className='flex items-center gap-2 font-normal'
                  >
                    <Checkbox
                      checked={serviceIds.includes(service.id)}
                      onCheckedChange={(checked) =>
                        setServiceIds((current) =>
                          checked
                            ? [...current, service.id]
                            : current.filter((value) => value !== service.id),
                        )
                      }
                    />
                    {service.name}
                  </Label>
                ))}
              </div>
            </FieldSet>
            <SwitchField
              id={`${id}-published`}
              label={t('monitoring.statusPages.publish')}
              description={t('monitoring.statusPages.publishHint')}
              checked={published}
              onChange={setPublished}
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
