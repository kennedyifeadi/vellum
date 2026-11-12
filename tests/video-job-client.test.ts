import { RetryCancelledError, sleep } from '@/lib/busy-retry';
import {
  VIDEO_JOB_POLL_INTERVAL_MS,
  VIDEO_JOB_RETRY,
  VideoJobUnreachableError,
  videoJobHeaders,
  videoJobLabel,
  videoResultFileName,
  videoResultMessage,
  waitForVideoJob,
  type VideoJobStatus,
} from '@/lib/video-job-client';

const status = (overrides: Partial<VideoJobStatus>): VideoJobStatus => ({ status: 'queued', fileName: 'a.mp4', originalSize: 10 * 1024 * 1024, ...overrides });

type Answer = { status?: number; body?: unknown; headers?: Record<string, string>; throws?: Error; notJson?: boolean };

const reply = ({ status: code = 200, body, headers = {}, notJson }: Answer): Response => ({
  ok: code >= 200 && code < 300,
  status: code,
  headers: new Headers(headers),
  json: async () => {
    if (notJson) throw new SyntaxError('Unexpected token < in JSON');
    return body;
  },
}) as unknown as Response;

function answers(...replies: Answer[]) {
  const fetchImpl = jest.fn();
  for (const answer of replies) {
    if (answer.throws) fetchImpl.mockRejectedValueOnce(answer.throws);
    else fetchImpl.mockResolvedValueOnce(reply(answer));
  }
  return fetchImpl;
}

/** A clock that only moves when the wait under test waits, so no test sleeps. */
function fakeClock() {
  let time = 0;
  const wait = jest.fn(async (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) throw new RetryCancelledError();
    time += ms;
  });
  return { wait, now: () => time, waits: () => wait.mock.calls.map(([ms]) => ms) };
}

const done = status({ status: 'done', savedPercent: 40 });

describe('waitForVideoJob', () => {
  it('polls every two seconds until the job ends, reporting each status', async () => {
    const fetchImpl = answers({ body: status({ position: 2 }) }, { body: status({ status: 'running' }) }, { body: done });
    const clock = fakeClock();
    const seen: string[] = [];

    const last = await waitForVideoJob({ jobId: 'j1' }, { fetchImpl, ...clock, onStatus: (s) => seen.push(videoJobLabel(s)) });

    expect(last).toMatchObject({ status: 'done', savedPercent: 40 });
    expect(seen).toEqual(['Queued (2 ahead)…', 'Compressing…', 'Compressing…']);
    expect(clock.waits()).toEqual([VIDEO_JOB_POLL_INTERVAL_MS, VIDEO_JOB_POLL_INTERVAL_MS]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/convert/video-compress/jobs/j1', expect.objectContaining({ headers: {} }));
  });

  it("sends a guest's token with every poll", async () => {
    const fetchImpl = answers({ body: status({ status: 'failed', error: 'Too slow' }) });

    expect(await waitForVideoJob({ jobId: 'j2', token: 'secret' }, { fetchImpl, ...fakeClock() })).toMatchObject({ status: 'failed', error: 'Too slow' });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ 'X-Job-Token': 'secret' });
  });

  it('keeps going after one poll that could not reach the server', async () => {
    const fetchImpl = answers({ throws: new TypeError('Failed to fetch') }, { body: done });
    const clock = fakeClock();

    expect(await waitForVideoJob({ jobId: 'j3' }, { fetchImpl, ...clock })).toMatchObject({ status: 'done' });
    expect(clock.waits()).toEqual([VIDEO_JOB_RETRY.firstDelayMs]);
  });

  it.each([
    ['a 502', { status: 502, body: { error: 'Bad gateway' } }],
    ['a 503 without a body', { status: 503, notJson: true }],
    ['a 200 whose body is not JSON', { notJson: true }],
  ])('keeps going after %s', async (_label, failure) => {
    const fetchImpl = answers(failure, { body: done });

    expect(await waitForVideoJob({ jobId: 'j4' }, { fetchImpl, ...fakeClock() })).toMatchObject({ status: 'done' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('waits as long as a 429 says, then goes on', async () => {
    const fetchImpl = answers({ status: 429, headers: { 'Retry-After': '7' }, body: { error: 'Too many requests' } }, { body: done });
    const clock = fakeClock();

    expect(await waitForVideoJob({ jobId: 'j5' }, { fetchImpl, ...clock })).toMatchObject({ status: 'done' });
    expect(clock.waits()).toEqual([7_000]);
  });

  it('backs off between failures, up to a ceiling, and starts again after a success', async () => {
    const failure = { status: 502 };
    const fetchImpl = answers(failure, failure, failure, failure, failure, { body: status({ status: 'running' }) }, failure, { body: done });
    const clock = fakeClock();

    await waitForVideoJob({ jobId: 'j6' }, { fetchImpl, ...clock });

    expect(clock.waits()).toEqual([2_000, 4_000, 8_000, 15_000, 15_000, VIDEO_JOB_POLL_INTERVAL_MS, 2_000]);
  });

  it('gives up with "lost contact" once polls have failed for two minutes, not before', async () => {
    const fetchImpl = jest.fn(async () => reply({ status: 502 }));
    const clock = fakeClock();

    const failure = await waitForVideoJob({ jobId: 'j7' }, { fetchImpl, ...clock }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(VideoJobUnreachableError);
    expect((failure as Error).message).toBe('Lost contact with the server.');

    const waited = clock.waits().reduce((sum, ms) => sum + ms, 0);
    expect(waited).toBeGreaterThanOrEqual(VIDEO_JOB_RETRY.giveUpAfterMs);
    expect(waited - clock.waits().at(-1)!).toBeLessThan(VIDEO_JOB_RETRY.giveUpAfterMs);
  });

  it('measures the two minutes from the first failure in a row, not from the start', async () => {
    const clock = fakeClock();
    let calls = 0;
    // Succeeds for ten minutes, then fails until it gives up.
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      return clock.now() < 600_000 ? reply({ body: status({ status: 'running' }) }) : reply({ status: 503 });
    });

    await expect(waitForVideoJob({ jobId: 'j8' }, { fetchImpl, ...clock })).rejects.toBeInstanceOf(VideoJobUnreachableError);
    expect(clock.now()).toBeGreaterThanOrEqual(600_000 + VIDEO_JOB_RETRY.giveUpAfterMs);
    expect(calls).toBeGreaterThan(300);
  });

  it.each([
    [404, { error: 'Job not found' }, 'This video job is no longer available.'],
    [403, { error: 'Forbidden' }, 'Forbidden'],
    [400, {}, 'Could not check on the video.'],
  ])('stops at once on a %i', async (code, body, message) => {
    const fetchImpl = answers({ status: code, body });
    const clock = fakeClock();

    await expect(waitForVideoJob({ jobId: 'j9' }, { fetchImpl, ...clock })).rejects.toThrow(message);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(clock.waits()).toEqual([]);
  });

  it('stops when cancelled between polls', async () => {
    const controller = new AbortController();
    const fetchImpl = answers({ body: status({}) });
    controller.abort();

    await expect(waitForVideoJob({ jobId: 'j10' }, { fetchImpl, signal: controller.signal, ...fakeClock() })).rejects.toBeInstanceOf(RetryCancelledError);
  });

  it('stops when cancelled during a poll', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(async () => {
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await expect(waitForVideoJob({ jobId: 'j11' }, { fetchImpl, signal: controller.signal, ...fakeClock() })).rejects.toBeInstanceOf(RetryCancelledError);
  });

  it('stops at once when cancelled during the backoff after a failure', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetchImpl = jest.fn(async () => reply({ status: 502 }));
      const waiting = waitForVideoJob({ jobId: 'j12' }, { fetchImpl, signal: controller.signal, wait: sleep });
      const outcome = expect(waiting).rejects.toBeInstanceOf(RetryCancelledError);

      await jest.advanceTimersByTimeAsync(1_000);
      controller.abort();
      await outcome;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the drawer text for a video job', () => {
  it('says how far back in the queue a job is', () => {
    expect(videoJobLabel({ status: 'queued', position: 0 })).toBe('Queued (0 ahead)…');
    expect(videoJobLabel({ status: 'running' })).toBe('Compressing…');
  });

  it('names the saving, or that nothing was saved', () => {
    expect(videoResultMessage(status({ status: 'done', savedPercent: 25, compressedSize: 7.5 * 1024 * 1024 }))).toBe('Reduced by 25% — 2.5 MB saved!');
    expect(videoResultMessage(status({ status: 'done', savedPercent: 0 }))).toBe('Video was already well-compressed, so it is unchanged.');
  });

  it('builds no token header for a signed-in owner', () => {
    expect(videoJobHeaders({ jobId: 'j' })).toEqual({});
  });
});

describe('videoResultFileName', () => {
  const download = (headers: Record<string, string> = {}) => ({ headers: new Headers(headers) }) as Response;

  it("uses the name the download's Content-Disposition gives", () => {
    const headers = { 'Content-Disposition': `attachment; filename="compressed___.mp4"; filename*=UTF-8''compressed_%E6%97%85%E8%A1%8C.mp4` };

    expect(videoResultFileName(download(headers), '旅行.mov')).toBe('compressed_旅行.mp4');
  });

  it.each([
    ['clip.mov', 'compressed_clip.mp4'],
    ['clip.MKV', 'compressed_clip.mp4'],
    ['my.holiday.webm', 'compressed_my.holiday.mp4'],
    ['no-extension', 'compressed_no-extension.mp4'],
  ])('names %s as MP4 when the download has no Content-Disposition', (input, expected) => {
    expect(videoResultFileName(download(), input)).toBe(expected);
  });

  it('falls back when the header names no file', () => {
    expect(videoResultFileName(download({ 'Content-Disposition': 'attachment' }), 'clip.mov')).toBe('compressed_clip.mp4');
  });
});
