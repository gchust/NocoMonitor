import { useApiClient } from '@nocobase/app-client';
import { useEffect, useReducer, useState } from 'react';

export interface ApiData<T> {
  /** The last answer, kept while a reload or refresh is in flight. */
  readonly data: T | undefined;
  /** The failure of the latest request, if it failed. */
  readonly error: unknown;
  /** True until the first answer for the current request arrives. */
  readonly loading: boolean;
  readonly reload: () => void;
}

/**
 * Reads one endpoint and keeps the answer. Changing `path` or `query` aborts the old request so an older answer never
 * overwrites a newer one; `refreshMs` reads it again on a timer without showing a loading state, which a dashboard of
 * live status needs.
 */
export function useApiData<T>(
  path: string | null,
  query?: Record<string, string | number | undefined>,
  options: { refreshMs?: number } = {},
): ApiData<T> {
  const api = useApiClient();
  const [reloadCount, reload] = useReducer((count: number) => count + 1, 0);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([path, query ?? null, reloadCount]);
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: unknown;
  }>();

  useEffect(() => {
    if (!options.refreshMs) return;
    const timer = window.setInterval(() => {
      // A hidden tab does not need fresh numbers; it catches up when it is shown again.
      if (document.visibilityState === 'visible') setTick((value) => value + 1);
    }, options.refreshMs);
    return () => window.clearInterval(timer);
  }, [options.refreshMs]);

  useEffect(() => {
    // Read back from `key`, so the effect follows the request's value rather than the identity of `query`.
    const [requestPath, requestQuery] = JSON.parse(key) as [
      string | null,
      Record<string, string | number | undefined> | null,
    ];
    if (!requestPath) return;
    const controller = new AbortController();
    const request = {
      path: requestPath,
      query: requestQuery ?? undefined,
      signal: controller.signal,
    };
    api.request<T>(request).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult((previous) => ({ data: previous?.data, key, error }));
      },
    );
    return () => controller.abort();
  }, [api, key, tick]);

  return {
    data: result?.data,
    error: result?.key === key ? result.error : undefined,
    loading: result?.key !== key,
    reload,
  };
}
