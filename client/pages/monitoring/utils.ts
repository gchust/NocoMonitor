import { ApiClientError } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';

/** Whether the signed-in user may change monitoring configuration and incidents. */
export function useCanManage(): boolean {
  return useCan({
    resource: { type: 'settings', id: 'monitoring' },
    action: 'manage',
  }).can;
}

/** Why deciding a fix failed, in the reader's language: the server's own message is written for agents, in English. */
export function fixErrorText(
  error: unknown,
  t: (key: string) => string,
): string {
  const reason = error instanceof ApiClientError ? error.reason : undefined;
  if (reason === 'NOT_PENDING') return t('monitoring.fixes.errors.notPending');
  if (reason === 'REMEDIATION_NOT_FOUND' || reason === 'INCIDENT_NOT_FOUND')
    return t('monitoring.errors.notFound');
  if (reason === 'INCIDENT_RESOLVED')
    return t('monitoring.fixes.errors.resolved');
  if (error instanceof ApiClientError && error.status === 403)
    return t('monitoring.errors.forbidden');
  return t('monitoring.fixes.errors.failed');
}

/** The text of an error from a write, for a toast. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError || error instanceof Error)
    return error.message || fallback;
  return fallback;
}

/** The server's per-field validation messages, keyed by field name, from a failed write. */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (
    !(error instanceof ApiClientError) ||
    !error.payload ||
    typeof error.payload !== 'object'
  )
    return {};
  const detail: unknown = Reflect.get(error.payload, 'error');
  const violations: unknown =
    detail && typeof detail === 'object'
      ? Reflect.get(detail, 'fieldViolations')
      : undefined;
  if (!Array.isArray(violations)) return {};
  const errors: Record<string, string> = {};
  for (const violation of violations) {
    if (!violation || typeof violation !== 'object') continue;
    const field: unknown = Reflect.get(violation, 'field');
    const description: unknown = Reflect.get(violation, 'description');
    if (typeof field === 'string' && typeof description === 'string')
      errors[field.split('.')[0]] ??= description;
  }
  return errors;
}
