import { ApiClientError } from '@nocobase/app-client';

const REASONS: Record<string, string> = {
  AI_NOT_CONFIGURED: 'notConfigured',
  AGENT_UNAVAILABLE: 'agentUnavailable',
  SETUP_BUSY: 'busy',
  SETUP_CLOSED: 'closed',
  NOTHING_TO_APPLY: 'nothingToApply',
  PROPOSAL_STALE: 'stale',
  SETUP_NOT_FOUND: 'notFound',
};

/** Why a setup request failed, in the reader's language: the server's own message is written for agents, in English. */
export function setupErrorText(
  error: unknown,
  t: (key: string) => string,
): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) return t('monitoring.errors.forbidden');
    const reason = error.reason ? REASONS[error.reason] : undefined;
    if (reason) return t(`monitoring.setup.errors.${reason}`);
  }
  return t('monitoring.setup.errors.failed');
}
