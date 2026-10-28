import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

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
import { Spinner } from '#components/ui/spinner';

export type DrillAction = 'start' | 'end';

/**
 * Starting or ending a drill, each after its confirmation, wherever the drill is offered. `dialog` is the confirmation
 * to render; `ask` opens it. `onDone` runs after a successful action, `onSettled` after every attempt.
 */
export function useDrillAction({
  onDone,
  onSettled,
}: {
  readonly onDone?: (kind: DrillAction) => void;
  readonly onSettled?: () => void;
}): {
  busy: boolean;
  ask: (kind: DrillAction) => void;
  dialog: ReactElement;
} {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const [confirming, setConfirming] = useState<DrillAction | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (kind: DrillAction): Promise<void> => {
    setBusy(true);
    try {
      await api.request({
        path: 'monitoringDrill',
        method: kind === 'start' ? 'POST' : 'DELETE',
        ...(kind === 'start' ? { json: {} } : {}),
      });
      toaster.show({
        type: 'success',
        title: t(
          kind === 'start'
            ? 'monitoring.drill.started'
            : 'monitoring.drill.ended',
        ),
      });
      setConfirming(null);
      onDone?.(kind);
    } catch {
      toaster.show({
        type: 'error',
        title: t(
          kind === 'start'
            ? 'monitoring.drill.startFailed'
            : 'monitoring.drill.endFailed',
        ),
      });
    } finally {
      setBusy(false);
      onSettled?.();
    }
  };

  const dialog = (
    <AlertDialog
      open={confirming !== null}
      onOpenChange={(open) => {
        if (!open && !busy) setConfirming(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(
              confirming === 'end'
                ? 'monitoring.drill.endTitle'
                : 'monitoring.drill.confirmTitle',
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              confirming === 'end'
                ? 'monitoring.drill.endDescription'
                : 'monitoring.drill.confirmDescription',
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t('monitoring.actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            variant={confirming === 'end' ? 'destructive' : 'default'}
            onClick={() => {
              if (confirming) void act(confirming);
            }}
          >
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t(
              confirming === 'end'
                ? 'monitoring.drill.end'
                : 'monitoring.drill.confirm',
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { busy, ask: setConfirming, dialog };
}
