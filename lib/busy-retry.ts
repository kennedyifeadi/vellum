// How the upload screen waits out a tool that is busy rather than failing. A full slot
// pool answers 503 and the caller's own running job answers 429, both with Retry-After;
// the rate limiter's 429 carries none, so it is never retried, and neither is any other
// error.

export const BUSY_RETRY_POLICY = {
  /** No retry is started once it would end later than this after the first answer. */
  maxTotalWaitMs: 120_000,
  /** Added at random to each wait, so callers who were refused together do not return together. */
  maxJitterMs: 1_000,
};

const RETRYABLE_STATUSES = new Set([429, 503]);

export class RetryCancelledError extends Error {
  constructor() {
    super('Waiting for a free slot was cancelled.');
    this.name = 'RetryCancelledError';
  }
}

type Answer = Pick<Response, 'status' | 'headers'>;

/** How long to wait before sending again, or null when the answer is final. */
export function retryDelayMs(answer: Answer, random: () => number = Math.random): number | null {
  if (!RETRYABLE_STATUSES.has(answer.status)) return null;
  const retryAfter = answer.headers.get('Retry-After');
  if (retryAfter === null || !/^\d+$/.test(retryAfter.trim())) return null;
  return Number(retryAfter) * 1000 + Math.floor(random() * BUSY_RETRY_POLICY.maxJitterMs);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RetryCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RetryCancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface BusyRetryOptions {
  signal?: AbortSignal;
  /** Told true while waiting between attempts and false when an attempt is sent. */
  onWaiting?: (waiting: boolean) => void;
  now?: () => number;
  random?: () => number;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Sends the request, and again each time the tool answers that it is busy, until it
 * answers otherwise or the next wait would pass the total. Returns the last answer, so a
 * caller that gives up shows the server's own message. Rejects with RetryCancelledError
 * when `signal` aborts during a wait.
 */
export async function fetchWithBusyRetry(
  send: () => Promise<Response>,
  { signal, onWaiting, now = Date.now, random = Math.random, wait = sleep }: BusyRetryOptions = {},
): Promise<Response> {
  let startedAt: number | null = null;
  for (;;) {
    onWaiting?.(false);
    const response = await send();
    startedAt ??= now();

    const delayMs = retryDelayMs(response, random);
    if (delayMs === null || now() - startedAt + delayMs > BUSY_RETRY_POLICY.maxTotalWaitMs) {
      return response;
    }

    await response.body?.cancel();
    onWaiting?.(true);
    await wait(delayMs, signal);
  }
}
