import {
  BUSY_RETRY_POLICY,
  RetryCancelledError,
  fetchWithBusyRetry,
  retryDelayMs,
  sleep,
} from '@/lib/busy-retry';

const BUSY = 'Compress Image is busy right now. Please try again in a few seconds.';
const IN_PROGRESS = 'You already have a conversion in progress. Please wait for it to finish.';
const RATE_LIMITED = 'Too many requests. Please try again later.';

function answer(status: number, error?: string, retryAfter?: string): Response {
  const headers: Record<string, string> = {};
  if (retryAfter !== undefined) headers['Retry-After'] = retryAfter;
  return new Response(error ? JSON.stringify({ error }) : 'ok', { status, headers });
}

const busy = () => answer(503, BUSY, '5');

/** A clock that only moves when the code under test waits, and a log of those waits. */
function fakeTime(random = 0.5) {
  let clock = 1_000_000;
  const waits: number[] = [];
  return {
    waits,
    now: () => clock,
    random: () => random,
    wait: async (ms: number) => {
      waits.push(ms);
      clock += ms;
    },
  };
}

function sender(...answers: Response[]) {
  const send = jest.fn(() => Promise.resolve(answers.shift()!));
  return send;
}

describe('retryDelayMs', () => {
  it.each([
    ['503 busy', answer(503, BUSY, '5')],
    ['429 conversion in progress', answer(429, IN_PROGRESS, '5')],
  ])('waits Retry-After plus jitter on a %s', (_, res) => {
    expect(retryDelayMs(res, () => 0)).toBe(5_000);
    expect(retryDelayMs(res, () => 0.999)).toBe(5_000 + 999);
  });

  it.each([
    ['the rate limiter’s 429, which has no Retry-After', answer(429, RATE_LIMITED)],
    ['a 400', answer(400, 'Your current plan allows PDFs up to 25MB.')],
    ['a 400 even with Retry-After', answer(400, 'Bad file', '5')],
    ['a 500', answer(500, 'Failed to compress PDF.')],
    ['a 503 without Retry-After', answer(503, 'Unavailable')],
    ['a Retry-After that is a date', answer(503, BUSY, 'Wed, 21 Oct 2026 07:28:00 GMT')],
    ['a success', answer(200)],
  ])('is final for %s', (_, res) => {
    expect(retryDelayMs(res, () => 0.5)).toBeNull();
  });

  it('keeps the jitter within bounds for any random value', () => {
    for (const random of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const delay = retryDelayMs(busy(), () => random)!;
      expect(delay).toBeGreaterThanOrEqual(5_000);
      expect(delay).toBeLessThan(5_000 + BUSY_RETRY_POLICY.maxJitterMs);
    }
  });
});

describe('fetchWithBusyRetry', () => {
  it('waits Retry-After after a 503, sends again and returns the success', async () => {
    const time = fakeTime(0);
    const send = sender(busy(), answer(200));

    const res = await fetchWithBusyRetry(send, time);

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
    expect(time.waits).toEqual([5_000]);
  });

  it('waits out the caller’s own conversion in progress the same way', async () => {
    const time = fakeTime(0);
    const send = sender(answer(429, IN_PROGRESS, '5'), answer(429, IN_PROGRESS, '5'), answer(200));

    const res = await fetchWithBusyRetry(send, time);

    expect(res.status).toBe(200);
    expect(time.waits).toEqual([5_000, 5_000]);
  });

  it.each([
    ['the rate limiter’s 429', answer(429, RATE_LIMITED)],
    ['a 400', answer(400, 'Bad file')],
    ['a 500', answer(500, 'Failed')],
  ])('returns %s at once without retrying', async (_, final) => {
    const time = fakeTime();
    const send = sender(final);

    const res = await fetchWithBusyRetry(send, time);

    expect(res).toBe(final);
    expect(send).toHaveBeenCalledTimes(1);
    expect(time.waits).toEqual([]);
  });

  it('gives up with the server’s last answer once the next wait would pass the total', async () => {
    const time = fakeTime(0.5);
    const send = jest.fn(() => Promise.resolve(busy()));

    const res = await fetchWithBusyRetry(send, time);

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(BUSY);
    const waited = time.waits.reduce((sum, ms) => sum + ms, 0);
    expect(waited).toBeLessThanOrEqual(BUSY_RETRY_POLICY.maxTotalWaitMs);
    expect(waited + 5_500).toBeGreaterThan(BUSY_RETRY_POLICY.maxTotalWaitMs);
    expect(send).toHaveBeenCalledTimes(time.waits.length + 1);
  });

  it('counts the time the attempts themselves take toward the total', async () => {
    const time = fakeTime(0);
    let clock = 0;
    const send = jest.fn(async () => {
      clock += 60_000;
      return busy();
    });

    await fetchWithBusyRetry(send, { ...time, now: () => time.now() + clock });

    // Answers at 0s, 65s and 130s after the first: the third is past the total.
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('reports waiting between attempts and not while an attempt is sent', async () => {
    const time = fakeTime(0);
    const states: boolean[] = [];

    await fetchWithBusyRetry(sender(busy(), answer(200)), { ...time, onWaiting: (waiting) => states.push(waiting) });

    expect(states).toEqual([false, true, false]);
  });

  it('stops when cancelled during a wait and sends nothing more', async () => {
    const controller = new AbortController();
    const send = jest.fn(() => Promise.resolve(busy()));
    const wait = (_ms: number, signal?: AbortSignal) => {
      controller.abort();
      return sleep(0, signal);
    };

    await expect(fetchWithBusyRetry(send, { signal: controller.signal, wait })).rejects.toBeInstanceOf(RetryCancelledError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends the same request each time', async () => {
    const time = fakeTime(0);
    const body = new FormData();
    body.append('googleDriveFiles', JSON.stringify({ id: 'drive-1', accessToken: 't', name: 'a.pdf' }));
    const bodies: FormData[] = [];
    const send = jest.fn(async () => {
      bodies.push(body);
      return bodies.length === 1 ? busy() : answer(200);
    });

    await fetchWithBusyRetry(send, time);

    expect(bodies).toHaveLength(2);
    expect(bodies[1].get('googleDriveFiles')).toBe(bodies[0].get('googleDriveFiles'));
  });
});

describe('sleep', () => {
  it('rejects at once when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(60_000, controller.signal)).rejects.toBeInstanceOf(RetryCancelledError);
  });
});
