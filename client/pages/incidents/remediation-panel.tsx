import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CheckIcon, PlayIcon, WrenchIcon, XIcon } from 'lucide-react';
import { useId, useRef, useState, type ReactElement } from 'react';

import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Card,
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
import { Field, FieldLabel } from '#components/ui/field';
import { Textarea } from '#components/ui/textarea';

import {
  formatDateTime,
  type Remediation,
  type RemediationOptions,
  type RemediationStatus,
} from '../../lib/monitoring.js';
import { ApproveFixDialog } from '../monitoring/approve-fix-dialog.js';
import { errorText, fixErrorText } from '../monitoring/utils.js';

const TONE: Record<
  RemediationStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'danger'
> = {
  pending: 'warning',
  rejected: 'neutral',
  running: 'info',
  failed: 'danger',
  verifying: 'info',
  verified: 'success',
  unverified: 'danger',
};

function toneOf(
  status: RemediationStatus,
): 'neutral' | 'info' | 'warning' | 'success' {
  const tone = TONE[status];
  return tone === 'danger' ? 'neutral' : tone;
}

/**
 * The fixes of an incident: what its service allows, what an agent asked for (approve or reject it), and what ran and
 * whether the probes saw the service recover.
 */
export function RemediationPanel({
  incidentId,
  data,
  resolved,
  canManage,
  onChanged,
}: {
  readonly incidentId: string;
  /** Read by the incident page, which shows the fixes' progress in its response card too. */
  readonly data: RemediationOptions;
  readonly resolved: boolean;
  readonly canManage: boolean;
  readonly onChanged: () => void;
}): ReactElement | null {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const [running, setRunning] = useState<{ key: string; title: string }>();
  const [approving, setApproving] = useState<Remediation | null>(null);
  const [busy, setBusy] = useState<string>();
  // Deciding a fix removes the buttons that were focused: focus returns to this card, not to the page.
  const cardRef = useRef<HTMLDivElement>(null);
  if (!data.actions.length && !data.remediations.length) return null;

  const reject = async (remediation: Remediation): Promise<void> => {
    setBusy(remediation.id);
    try {
      await api.request({
        path: `remediations/${encodeURIComponent(remediation.id)}/reject`,
        method: 'POST',
        json: {},
      });
      toaster.show({ type: 'success', title: t('monitoring.fixes.rejected') });
      cardRef.current?.focus();
    } catch (error) {
      toaster.show({ type: 'error', title: fixErrorText(error, t) });
    } finally {
      setBusy(undefined);
      onChanged();
    }
  };

  const active = data.remediations.some((item) =>
    ['pending', 'running', 'verifying'].includes(item.status),
  );

  return (
    <Card ref={cardRef} tabIndex={-1} className='outline-none'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <WrenchIcon className='size-5 text-muted-foreground' />
          {t('monitoring.fixes.title')}
        </CardTitle>
        <CardDescription>
          {t(`monitoring.remediation.${data.level}Hint`)}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        {data.remediations.length ? (
          <ul className='space-y-3'>
            {data.remediations.map((item) => (
              <li key={item.id} className='rounded-lg border p-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>{item.actionTitle}</span>
                  <StatusBadge
                    size='sm'
                    tone={toneOf(item.status)}
                    className={
                      TONE[item.status] === 'danger'
                        ? 'border-destructive/25 bg-destructive/8 text-destructive'
                        : undefined
                    }
                  >
                    {t(`monitoring.fixes.status.${item.status}`)}
                  </StatusBadge>
                  <span className='ml-auto text-xs text-muted-foreground'>
                    {t(`monitoring.fixes.requestedBy.${item.requestedByType}`, {
                      name: item.requestedByName ?? '',
                    })}{' '}
                    · {formatDateTime(item.createdAt, i18n.language)}
                  </span>
                </div>
                <p className='mt-1 whitespace-pre-wrap text-muted-foreground'>
                  {item.reason}
                </p>
                {item.httpStatus !== null || item.output ? (
                  <p
                    className='mt-1 truncate font-mono text-xs text-muted-foreground'
                    title={item.output ?? undefined}
                  >
                    {item.httpStatus !== null ? `HTTP ${item.httpStatus} ` : ''}
                    {item.output}
                  </p>
                ) : null}
                {item.status === 'pending' && canManage ? (
                  <div className='mt-2 flex gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy !== undefined}
                      onClick={() => setApproving(item)}
                    >
                      <CheckIcon data-icon='inline-start' />
                      {t('monitoring.fixes.approve')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy !== undefined}
                      onClick={() => void reject(item)}
                    >
                      <XIcon data-icon='inline-start' />
                      {t('monitoring.fixes.reject')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {canManage && !resolved && data.actions.length ? (
          <div className='space-y-2'>
            <h3 className='text-xs font-medium text-muted-foreground'>
              {t('monitoring.fixes.available')}
            </h3>
            <ul className='flex flex-wrap gap-2'>
              {data.actions.map((action) => (
                <li key={action.key}>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={active}
                    title={action.description ?? undefined}
                    onClick={() =>
                      setRunning({ key: action.key, title: action.title })
                    }
                  >
                    <PlayIcon data-icon='inline-start' />
                    {action.title}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
      {running ? (
        <RunFixDialog
          incidentId={incidentId}
          action={running}
          onClose={() => setRunning(undefined)}
          onDone={onChanged}
        />
      ) : null}
      <ApproveFixDialog
        remediation={approving}
        onClose={() => setApproving(null)}
        onDone={onChanged}
        approvedFocus={cardRef}
      />
    </Card>
  );
}

function RunFixDialog({
  incidentId,
  action,
  onClose,
  onDone,
}: {
  readonly incidentId: string;
  readonly action: { key: string; title: string };
  readonly onClose: () => void;
  readonly onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.request<{ data: Remediation }>({
        path: `incidents/${encodeURIComponent(incidentId)}/remediations`,
        method: 'POST',
        json: { action: action.key, reason },
      });
      toaster.show({
        type: result.data.status === 'failed' ? 'error' : 'success',
        title: t(`monitoring.fixes.status.${result.data.status}`),
      });
      onDone();
      onClose();
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {t('monitoring.fixes.runTitle', { title: action.title })}
          </DialogTitle>
          <DialogDescription>
            {t('monitoring.fixes.runDescription')}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={`${id}-reason`}>
            {t('monitoring.fixes.reason')}
          </FieldLabel>
          <Textarea
            id={`${id}-reason`}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('monitoring.actions.cancel')}
          </Button>
          <Button disabled={busy || !reason.trim()} onClick={() => void run()}>
            {busy ? t('monitoring.fixes.running') : t('monitoring.fixes.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
