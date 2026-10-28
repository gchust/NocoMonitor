import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';

export interface Diagnose {
  diagnose: () => Promise<void>;
  asking: boolean;
}

/** Asks the diagnosis agent to investigate the incident (again). */
export function useDiagnose(
  incidentId: string,
  onChanged: () => void,
): Diagnose {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const [asking, setAsking] = useState(false);
  const diagnose = async (): Promise<void> => {
    setAsking(true);
    try {
      await api.request({
        path: `incidents/${encodeURIComponent(incidentId)}/diagnose`,
        method: 'POST',
      });
      toaster.show({ type: 'success', title: t('monitoring.ai.requested') });
      onChanged();
    } catch (error) {
      toaster.show({
        type: 'error',
        title:
          error instanceof ApiClientError && error.status === 403
            ? t('monitoring.errors.forbidden')
            : t('monitoring.ai.requestFailed'),
      });
    } finally {
      setAsking(false);
    }
  };
  return { diagnose, asking };
}
