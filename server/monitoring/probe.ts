import type { MonitorRecord, ProbeResult } from './types.js';

/** At most this much of a response body is read: a status page is not a download manager. */
const MAX_BODY_BYTES = 512 * 1024;
/** How much of a failing body is kept with the check, for whoever diagnoses it. */
const SNIPPET_CHARS = 600;

type ProbeTarget = Pick<
  MonitorRecord,
  | 'type'
  | 'url'
  | 'method'
  | 'headers'
  | 'body'
  | 'expectedStatus'
  | 'keyword'
  | 'jsonPath'
  | 'jsonExpected'
  | 'timeoutMs'
  | 'degradedLatencyMs'
>;

/** `200-299`, `200,301-302`: whether `status` matches one of the comma-separated codes or ranges. */
export function statusMatches(expected: string, status: number): boolean {
  return expected
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => {
      const [from, to] = part.split('-').map((value) => Number(value.trim()));
      if (!Number.isFinite(from)) return false;
      return to === undefined
        ? status === from
        : Number.isFinite(to) && status >= from && status <= to;
    });
}

/** Reads a dotted path such as `data.items.0.ok` from parsed JSON. */
export function readJsonPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.').filter(Boolean)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

async function readBody(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_BODY_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function describeError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError')
      return `Timed out after ${timeoutMs} ms`;
    const cause = (
      error as Error & { cause?: { code?: string; message?: string } }
    ).cause;
    if (cause?.code)
      return `${error.message}: ${cause.code}${cause.message ? ` (${cause.message})` : ''}`;
    return error.message;
  }
  return String(error);
}

/**
 * Probes one monitor once. Never throws: every failure becomes a `down` result with the reason, so the caller always
 * has something to record.
 */
export async function probe(
  target: ProbeTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  const started = performance.now();
  const details: Record<string, unknown> = {
    url: target.url,
    method: target.method,
  };
  let response: Response;
  try {
    response = await fetchImpl(target.url, {
      method: target.method,
      headers: {
        'user-agent': 'NocoMonitor/1.0 (+uptime probe)',
        ...(target.headers ?? {}),
      },
      body:
        target.method === 'GET' || target.method === 'HEAD'
          ? undefined
          : (target.body ?? undefined),
      redirect: 'follow',
      signal: AbortSignal.timeout(target.timeoutMs),
    });
  } catch (error) {
    return {
      status: 'down',
      latencyMs: null,
      httpStatus: null,
      error: describeError(error, target.timeoutMs),
      details,
    };
  }

  let body = '';
  try {
    body = target.method === 'HEAD' ? '' : await readBody(response);
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      httpStatus: response.status,
      error: `Reading the response failed: ${describeError(error, target.timeoutMs)}`,
      details,
    };
  }
  const latencyMs = Math.round(performance.now() - started);
  details.finalUrl = response.url;
  details.contentType = response.headers.get('content-type');

  const fail = (error: string): ProbeResult => ({
    status: 'down',
    latencyMs,
    httpStatus: response.status,
    error,
    details: { ...details, bodySnippet: body.slice(0, SNIPPET_CHARS) },
  });

  if (!statusMatches(target.expectedStatus, response.status))
    return fail(`HTTP ${response.status}, expected ${target.expectedStatus}`);

  if (
    target.type === 'keyword' &&
    target.keyword &&
    !body.includes(target.keyword)
  )
    return fail(`The response does not contain "${target.keyword}"`);

  if (target.type === 'json' && target.jsonPath) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return fail('The response is not valid JSON');
    }
    const actual = readJsonPath(parsed, target.jsonPath);
    if (
      target.jsonExpected !== null &&
      target.jsonExpected !== undefined &&
      stringify(actual) !== target.jsonExpected
    )
      return fail(
        `${target.jsonPath} is ${stringify(actual)}, expected ${target.jsonExpected}`,
      );
  }

  const degraded =
    target.degradedLatencyMs !== null &&
    target.degradedLatencyMs > 0 &&
    latencyMs > target.degradedLatencyMs;
  return {
    status: degraded ? 'degraded' : 'up',
    latencyMs,
    httpStatus: response.status,
    error: degraded
      ? `Slow response: ${latencyMs} ms (threshold ${target.degradedLatencyMs} ms)`
      : null,
    details,
  };
}
