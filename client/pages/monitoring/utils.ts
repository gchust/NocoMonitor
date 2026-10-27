import { ApiClientError } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';

/** Whether the signed-in user may change monitoring configuration and incidents. */
export function useCanManage(): boolean {
  return useCan({
    resource: { type: 'settings', id: 'monitoring' },
    action: 'manage',
  }).can;
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
