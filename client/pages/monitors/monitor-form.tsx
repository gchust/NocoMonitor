import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useId,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

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
  Field,
  FieldDescription,
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
import { Switch } from '#components/ui/switch';

import {
  MONITOR_TYPES,
  REMEDIATION_LEVELS,
  type Monitor,
  type MonitorType,
  type RemediationLevel,
  type Service,
} from '../../lib/monitoring.js';
import { errorText, fieldErrorsOf } from '../monitoring/utils.js';

interface Draft {
  serviceId: string;
  name: string;
  type: MonitorType;
  region: string;
  url: string;
  method: string;
  expectedStatus: string;
  keyword: string;
  jsonPath: string;
  jsonExpected: string;
  intervalSec: string;
  timeoutMs: string;
  degradedLatencyMs: string;
  failureThreshold: string;
  recoveryThreshold: string;
  enabled: boolean;
  autoDiagnose: boolean;
  remediationLevel: RemediationLevel;
}

function draftOf(
  monitor: Monitor | undefined,
  services: readonly Service[],
): Draft {
  return {
    serviceId: monitor?.serviceId ?? services[0]?.id ?? '',
    name: monitor?.name ?? '',
    type: monitor?.type ?? 'http',
    region: monitor?.region ?? '',
    url: monitor?.url ?? 'https://',
    method: monitor?.method ?? 'GET',
    expectedStatus: monitor?.expectedStatus ?? '200-299',
    keyword: monitor?.keyword ?? '',
    jsonPath: monitor?.jsonPath ?? '',
    jsonExpected: monitor?.jsonExpected ?? '',
    intervalSec: String(monitor?.intervalSec ?? 60),
    timeoutMs: String(monitor?.timeoutMs ?? 10000),
    degradedLatencyMs: monitor?.degradedLatencyMs
      ? String(monitor.degradedLatencyMs)
      : '',
    failureThreshold: String(monitor?.failureThreshold ?? 2),
    recoveryThreshold: String(monitor?.recoveryThreshold ?? 2),
    enabled: monitor?.enabled ?? true,
    autoDiagnose: monitor?.autoDiagnose ?? true,
    remediationLevel: monitor?.remediationLevel ?? 'off',
  };
}

const blankToNull = (value: string): string | null =>
  value.trim() ? value.trim() : null;

/** Creates a monitor, or edits `monitor` when it is given. Mount it fresh for each opening. */
export function MonitorFormDialog({
  monitor,
  services,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly monitor?: Monitor;
  readonly services: readonly Service[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (monitor: Monitor) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(monitor, services));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    const json = {
      serviceId: draft.serviceId,
      name: draft.name,
      type: draft.type,
      region: blankToNull(draft.region),
      url: draft.url.trim(),
      method: draft.method,
      expectedStatus: draft.expectedStatus,
      keyword: draft.type === 'keyword' ? blankToNull(draft.keyword) : null,
      jsonPath: draft.type === 'json' ? blankToNull(draft.jsonPath) : null,
      jsonExpected:
        draft.type === 'json' ? blankToNull(draft.jsonExpected) : null,
      intervalSec: Number(draft.intervalSec),
      timeoutMs: Number(draft.timeoutMs),
      degradedLatencyMs: draft.degradedLatencyMs.trim()
        ? Number(draft.degradedLatencyMs)
        : null,
      failureThreshold: Number(draft.failureThreshold),
      recoveryThreshold: Number(draft.recoveryThreshold),
      enabled: draft.enabled,
      autoDiagnose: draft.autoDiagnose,
      remediationLevel: draft.remediationLevel,
    };
    try {
      const saved = await api.request<{ data: Monitor }>(
        monitor
          ? {
              path: `monitors/${encodeURIComponent(monitor.id)}`,
              method: 'PATCH',
              json,
            }
          : { path: 'monitors', method: 'POST', json },
      );
      toaster.show({
        type: 'success',
        title: t('monitoring.monitors.saved', { name: saved.data.name }),
      });
      onSaved(saved.data);
      onOpenChange(false);
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

  const serviceItems = services.map((service) => ({
    value: service.id,
    label: service.name,
  }));
  const typeItems = MONITOR_TYPES.map((value) => ({
    value,
    label: t(`monitoring.monitorType.${value}`),
  }));
  const remediationItems = REMEDIATION_LEVELS.map((value) => ({
    value,
    label: t(`monitoring.remediation.${value}`),
  }));
  const methodItems = ['GET', 'HEAD', 'POST'].map((value) => ({
    value,
    label: value,
  }));

  const text = (
    key: keyof Draft,
    label: string,
    props: {
      type?: string;
      placeholder?: string;
      description?: ReactNode;
    } = {},
  ) => (
    <Field data-invalid={Boolean(errors[key])}>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        type={props.type ?? 'text'}
        value={String(draft[key])}
        placeholder={props.placeholder}
        aria-invalid={Boolean(errors[key])}
        onChange={(event) => set(key, event.target.value as never)}
      />
      {props.description ? (
        <FieldDescription>{props.description}</FieldDescription>
      ) : null}
      {errors[key] ? <FieldError>{errors[key]}</FieldError> : null}
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <form onSubmit={(event) => void submit(event)} className='space-y-6'>
          <DialogHeader>
            <DialogTitle>
              {monitor
                ? t('monitoring.monitors.edit')
                : t('monitoring.monitors.add')}
            </DialogTitle>
            <DialogDescription>
              {t('monitoring.monitors.formDescription')}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className='grid gap-4 sm:grid-cols-2'>
            <Field data-invalid={Boolean(errors.serviceId)}>
              <FieldLabel htmlFor={`${id}-service`}>
                {t('monitoring.fields.service')}
              </FieldLabel>
              <Select
                items={serviceItems}
                value={draft.serviceId}
                onValueChange={(value: string | null) =>
                  value && set('serviceId', value)
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
              {errors.serviceId ? (
                <FieldError>{errors.serviceId}</FieldError>
              ) : null}
            </Field>
            {text('name', t('monitoring.fields.name'))}
            <Field>
              <FieldLabel htmlFor={`${id}-type`}>
                {t('monitoring.fields.type')}
              </FieldLabel>
              <Select
                items={typeItems}
                value={draft.type}
                onValueChange={(value: MonitorType | null) =>
                  value && set('type', value)
                }
              >
                <SelectTrigger id={`${id}-type`} className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {text('region', t('monitoring.fields.region'), {
              placeholder: t('monitoring.monitors.regionPlaceholder'),
            })}
            <div className='grid gap-4 sm:col-span-2 sm:grid-cols-[8rem_1fr]'>
              <Field>
                <FieldLabel htmlFor={`${id}-method`}>
                  {t('monitoring.fields.method')}
                </FieldLabel>
                <Select
                  items={methodItems}
                  value={draft.method}
                  onValueChange={(value: string | null) =>
                    value && set('method', value)
                  }
                >
                  <SelectTrigger id={`${id}-method`} className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {methodItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {text('url', t('monitoring.fields.url'), { type: 'url' })}
            </div>
            {text('expectedStatus', t('monitoring.fields.expectedStatus'), {
              description: t('monitoring.monitors.expectedStatusHint'),
            })}
            {draft.type === 'keyword'
              ? text('keyword', t('monitoring.fields.keyword'), {
                  description: t('monitoring.monitors.keywordHint'),
                })
              : null}
            {draft.type === 'json' ? (
              <>
                {text('jsonPath', t('monitoring.fields.jsonPath'), {
                  placeholder: 'data.status',
                })}
                {text('jsonExpected', t('monitoring.fields.jsonExpected'), {
                  placeholder: 'true',
                })}
              </>
            ) : null}
            {text('intervalSec', t('monitoring.fields.intervalSec'), {
              type: 'number',
            })}
            {text('timeoutMs', t('monitoring.fields.timeoutMs'), {
              type: 'number',
            })}
            {text(
              'degradedLatencyMs',
              t('monitoring.fields.degradedLatencyMs'),
              {
                type: 'number',
                description: t('monitoring.monitors.degradedHint'),
              },
            )}
            <div className='grid grid-cols-2 gap-4'>
              {text(
                'failureThreshold',
                t('monitoring.fields.failureThreshold'),
                { type: 'number' },
              )}
              {text(
                'recoveryThreshold',
                t('monitoring.fields.recoveryThreshold'),
                { type: 'number' },
              )}
            </div>
          </FieldGroup>

          <FieldGroup className='rounded-lg border p-4'>
            <SwitchField
              id={`${id}-enabled`}
              label={t('monitoring.fields.enabled')}
              description={t('monitoring.monitors.enabledHint')}
              checked={draft.enabled}
              onChange={(checked) => set('enabled', checked)}
            />
            <SwitchField
              id={`${id}-autoDiagnose`}
              label={t('monitoring.fields.autoDiagnose')}
              description={t('monitoring.monitors.autoDiagnoseHint')}
              checked={draft.autoDiagnose}
              onChange={(checked) => set('autoDiagnose', checked)}
            />
            <Field>
              <FieldLabel htmlFor={`${id}-remediation`}>
                {t('monitoring.fields.remediationLevel')}
              </FieldLabel>
              <Select
                items={remediationItems}
                value={draft.remediationLevel}
                onValueChange={(value: RemediationLevel | null) =>
                  value && set('remediationLevel', value)
                }
              >
                <SelectTrigger id={`${id}-remediation`} className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {remediationItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {t(`monitoring.remediation.${draft.remediationLevel}Hint`)}
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              {t('monitoring.actions.cancel')}
            </Button>
            <Button type='submit' disabled={busy || !draft.serviceId}>
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

export function SwitchField({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <Field orientation='horizontal'>
      <div className='flex-1 space-y-1'>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}
