import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement, type RefObject } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#components/ui/alert-dialog';

import type { Remediation } from '../../lib/monitoring.js';
import { fixErrorText } from './utils.js';

/**
 * Asks before running a fix an agent requested: approving calls a production endpoint at once. A failure stays in the
 * dialog, which cannot be closed while the request runs. Once approved, the buttons that opened it are gone, so focus
 * moves to `approvedFocus`; cancelling returns it to the button as usual.
 */
export function ApproveFixDialog({
  remediation,
  onClose,
  onDone,
  approvedFocus,
}: {
  readonly remediation: Pick<Remediation, 'id' | 'actionTitle'> | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
  readonly approvedFocus?: RefObject<HTMLElement | null>;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [approved, setApproved] = useState(false);

  const approve = async (): Promise<void> => {
    if (!remediation) return;
    setBusy(true);
    setError(undefined);
    setApproved(false);
    try {
      await api.request({
        path: `remediations/${encodeURIComponent(remediation.id)}/approve`,
        method: 'POST',
      });
      toaster.show({
        type: 'success',
        title: t('monitoring.fixes.confirmed', {
          action: remediation.actionTitle,
        }),
      });
      setApproved(true);
      onDone();
      onClose();
    } catch (cause) {
      setError(fixErrorText(cause, t));
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={remediation !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setError(undefined);
          onClose();
        }
      }}
    >
      <AlertDialogContent
        finalFocus={approved && approvedFocus ? approvedFocus : undefined}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('monitoring.fixes.confirmTitle', {
              action: remediation?.actionTitle,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('monitoring.fixes.confirmDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t('monitoring.actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={() => void approve()}>
            {busy
              ? t('monitoring.fixes.running')
              : t('monitoring.fixes.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
