import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useId, type ReactElement } from 'react';

import { Button } from '#components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '#components/ui/field';
import { Input } from '#components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Textarea } from '#components/ui/textarea';

import type { RemediationAction } from '../../lib/monitoring.js';

const METHODS = ['POST', 'PUT', 'GET'] as const;

/** `Name: value` per line, the way the headers are edited. */
function headersText(headers: Record<string, string> | null): string {
  return Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

function parseHeaders(text: string): Record<string, string> | null {
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): [string, string] => {
      const colon = line.indexOf(':');
      return colon > 0
        ? [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]
        : [line, ''];
    });
  return entries.length ? Object.fromEntries(entries) : null;
}

/**
 * The fixes a service allows, each one fixed HTTP call. Agents pick them by key and never see their URL's secrets or
 * header values; saved header values come back masked and are kept when left masked.
 */
export function RemediationActionsEditor({
  actions,
  onChange,
  error,
}: {
  readonly actions: readonly RemediationAction[];
  readonly onChange: (actions: RemediationAction[]) => void;
  readonly error?: string;
}): ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const update = (index: number, values: Partial<RemediationAction>): void =>
    onChange(
      actions.map((action, at) =>
        at === index ? { ...action, ...values } : action,
      ),
    );

  return (
    <FieldSet>
      <FieldLegend variant='label'>
        {t('monitoring.services.fixes')}
      </FieldLegend>
      <FieldDescription>{t('monitoring.services.fixesHint')}</FieldDescription>
      <ul className='space-y-3'>
        {actions.map((action, index) => (
          // The position is the identity while editing: the key is one of the fields being typed.
          // eslint-disable-next-line @eslint-react/no-array-index-key
          <li key={index} className='space-y-3 rounded-lg border p-3'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor={`${id}-${index}-key`}>
                  {t('monitoring.services.fixKey')}
                </FieldLabel>
                <Input
                  id={`${id}-${index}-key`}
                  value={action.key}
                  placeholder='restart'
                  onChange={(event) =>
                    update(index, { key: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-${index}-title`}>
                  {t('monitoring.fields.title')}
                </FieldLabel>
                <Input
                  id={`${id}-${index}-title`}
                  value={action.title}
                  onChange={(event) =>
                    update(index, { title: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-${index}-description`}>
                {t('monitoring.fields.description')}
              </FieldLabel>
              <Input
                id={`${id}-${index}-description`}
                value={action.description ?? ''}
                placeholder={t('monitoring.services.fixDescriptionPlaceholder')}
                onChange={(event) =>
                  update(index, { description: event.target.value || null })
                }
              />
            </Field>
            <div className='grid gap-3 sm:grid-cols-[7rem_1fr]'>
              <Field>
                <FieldLabel htmlFor={`${id}-${index}-method`}>
                  {t('monitoring.fields.method')}
                </FieldLabel>
                <Select
                  items={METHODS.map((value) => ({ value, label: value }))}
                  value={action.method}
                  onValueChange={(value: RemediationAction['method'] | null) =>
                    value && update(index, { method: value })
                  }
                >
                  <SelectTrigger
                    id={`${id}-${index}-method`}
                    className='w-full'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-${index}-url`}>
                  {t('monitoring.fields.url')}
                </FieldLabel>
                <Input
                  id={`${id}-${index}-url`}
                  type='url'
                  value={action.url}
                  placeholder='https://deploy.example.com/hooks/restart'
                  onChange={(event) =>
                    update(index, { url: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`${id}-${index}-headers`}>
                {t('monitoring.services.fixHeaders')}
              </FieldLabel>
              <Textarea
                id={`${id}-${index}-headers`}
                rows={2}
                className='font-mono text-xs'
                value={headersText(action.headers)}
                placeholder='Authorization: Bearer …'
                onChange={(event) =>
                  update(index, { headers: parseHeaders(event.target.value) })
                }
              />
              <FieldDescription>
                {t('monitoring.services.fixHeadersHint')}
              </FieldDescription>
            </Field>
            <div className='flex justify-end'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() =>
                  onChange(actions.filter((_, at) => at !== index))
                }
              >
                <Trash2Icon data-icon='inline-start' />
                {t('monitoring.services.removeFix')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error ? <FieldError>{error}</FieldError> : null}
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='w-fit'
        onClick={() =>
          onChange([
            ...actions,
            {
              key: '',
              title: '',
              description: null,
              method: 'POST',
              url: '',
              headers: null,
              body: null,
            },
          ])
        }
      >
        <PlusIcon data-icon='inline-start' />
        {t('monitoring.services.addFix')}
      </Button>
    </FieldSet>
  );
}
