import { RetryCancelledError } from '@/lib/busy-retry';
import {
  VIDEO_JOB_POLL_INTERVAL_MS,
  videoJobHeaders,
  videoJobLabel,
  videoResultMessage,
  waitForVideoJob,
  type VideoJobStatus,
} from '@/lib/video-job-client';

const status = (overrides: Partial<VideoJobStatus>): VideoJobStatus => ({ status: 'queued', fileName: 'a.mp4', originalSize: 10 * 1024 * 1024, ...overrides });

function answers(...bodies: { ok?: boolean; body: unknown }[]) {
  const fetchImpl = jest.fn();
  for (const { ok = true, body } of bodies) {
    fetchImpl.mockResolvedValueOnce({ ok, json: async () => body });
  }
  return fetchImpl;
}

describe('waitForVideoJob', () => {
  it('polls every two seconds until the job ends, reporting each status', async () => {
    const fetchImpl = answers(
      { body: status({ position: 2 }) },
      { body: status({ status: 'running' }) },
      { body: status({ status: 'done', savedPercent: 40 }) },
    );
    const wait = jest.fn().mockResolvedValue(undefined);
    const seen: string[] = [];

    const last = await waitForVideoJob({ jobId: 'j1' }, { fetchImpl, wait, onStatus: (s) => seen.push(videoJobLabel(s)) });

    expect(last).toMatchObject({ status: 'done', savedPercent: 40 });
    expect(seen).toEqual(['Queued (2 ahead)…', 'Compressing…', 'Compressing…']);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([VIDEO_JOB_POLL_INTERVAL_MS, VIDEO_JOB_POLL_INTERVAL_MS]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/convert/video-compress/jobs/j1', expect.objectContaining({ headers: {} }));
  });

  it("sends a guest's token with every poll", async () => {
    const fetchImpl = answers({ body: status({ status: 'failed', error: 'Too slow' }) });

    expect(await waitForVideoJob({ jobId: 'j2', token: 'secret' }, { fetchImpl })).toMatchObject({ status: 'failed', error: 'Too slow' });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ 'X-Job-Token': 'secret' });
  });

  it("rejects with the server's message when the job cannot be read", async () => {
    const fetchImpl = answers({ ok: false, body: { error: 'Job not found' } });

    await expect(waitForVideoJob({ jobId: 'j3' }, { fetchImpl })).rejects.toThrow('Job not found');
  });

  it('stops when cancelled between polls', async () => {
    const controller = new AbortController();
    const fetchImpl = answers({ body: status({}) });
    controller.abort();

    await expect(waitForVideoJob({ jobId: 'j4' }, { fetchImpl, signal: controller.signal })).rejects.toBeInstanceOf(RetryCancelledError);
  });

  it('stops when cancelled during a poll', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(async () => {
      controller.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await expect(waitForVideoJob({ jobId: 'j5' }, { fetchImpl, signal: controller.signal })).rejects.toBeInstanceOf(RetryCancelledError);
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
