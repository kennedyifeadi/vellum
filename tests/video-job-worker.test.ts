import { newVideoJobId, type VideoJob, type VideoJobStore } from '@/lib/video/video-job-store';
import {
  cancelVideoJob,
  UNEXPECTED_FAILURE_MESSAGE,
  VIDEO_JOB_HEARTBEAT_MS,
  VIDEO_JOB_LEASE_MS,
  VIDEO_JOB_POLL_MS,
  VIDEO_JOB_SWEEP_MS,
  VIDEO_RESULT_TTL_MS,
  VideoJobFailure,
  VideoJobWorker,
  WORKER_STOPPED_MESSAGE,
  type EncodedVideo,
  type VideoEncodeRequest,
} from '@/lib/video/video-job-worker';
import { createMemoryStorage, createMemoryVideoJobStore } from './helpers/memoryVideoJobStore';
import { newJob } from './helpers/videoJobStoreContract';

jest.setTimeout(30_000);

const MP4 = { extension: 'mp4', contentType: 'video/mp4' };

interface PendingEncode extends VideoEncodeRequest {
  succeed(bytes?: Buffer): void;
  fail(error: Error): void;
}

/** An encoder whose encodes end only when the test says so, or when they are aborted. */
function heldEncoder() {
  const pending: PendingEncode[] = [];
  const encode = ({ job, input, signal }: VideoEncodeRequest) =>
    new Promise<EncodedVideo>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new VideoJobFailure('The upload was cancelled.')), { once: true });
      pending.push({
        job,
        input,
        signal,
        succeed: (bytes = Buffer.from('small')) => resolve({ bytes, compressed: true, format: MP4 }),
        fail: reject,
      });
    });
  const encodeOf = (id: string) => pending.find((call) => call.job.id === id)!;
  return { encode, pending, encodeOf, started: () => pending.map((call) => call.job.id) };
}

// Lets every promise chain that is ready run, without moving the fake clock.
async function settle() {
  for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(0);
}

let store: ReturnType<typeof createMemoryVideoJobStore>;
let storage: ReturnType<typeof createMemoryStorage>;
let encoder: ReturnType<typeof heldEncoder>;
let ended: VideoJob[];
let workers: VideoJobWorker[];
let createdAt: number;

function worker(options: { store?: VideoJobStore; slots?: number } = {}) {
  const created = new VideoJobWorker({
    store: options.store ?? store,
    storage,
    encode: encoder.encode,
    onJobEnded: async (job) => {
      ended.push(job);
    },
    slots: options.slots ?? 2,
    guestSlots: 1,
  });
  workers.push(created);
  return created;
}

async function enqueue(overrides: { guest?: boolean } = {}): Promise<string> {
  const id = newVideoJobId();
  const job = newJob({ id, guest: overrides.guest ?? false });
  await storage.put(job.inputKey!, Buffer.from(`input of ${id}`));
  createdAt += 1;
  await store.create(job, new Date(createdAt));
  return id;
}

const status = async (id: string) => (await store.get(id))!.status;

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2026, 10, 10) });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  store = createMemoryVideoJobStore();
  storage = createMemoryStorage();
  encoder = heldEncoder();
  ended = [];
  workers = [];
  createdAt = Date.now() - 1000;
});

afterEach(async () => {
  for (const created of workers) {
    created.stop();
    created.abortAll();
  }
  await settle();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the video job worker: claiming', () => {
  it('claims jobs oldest first, runs at most two, and starts the next when one ends', async () => {
    const [first, second, third] = [await enqueue(), await enqueue(), await enqueue()];
    worker().start();
    await settle();

    expect(encoder.started()).toEqual([first, second]);
    expect(await status(third)).toBe('queued');

    encoder.encodeOf(second).succeed();
    await settle();

    expect(await status(second)).toBe('done');
    expect(encoder.started()).toEqual([first, second, third]);
  });

  it('hands the encoder the stored input', async () => {
    const id = await enqueue();
    worker().start();
    await settle();

    expect(encoder.encodeOf(id).input.toString()).toBe(`input of ${id}`);
  });

  it('keeps the second slot for a signed-in user while a guest holds the first', async () => {
    const guestA = await enqueue({ guest: true });
    const guestB = await enqueue({ guest: true });
    const user = await enqueue();
    worker().start();
    await settle();

    expect(encoder.started()).toEqual([guestA, user]);

    encoder.encodeOf(user).succeed();
    await settle();
    expect(await status(guestB)).toBe('queued');

    encoder.encodeOf(guestA).succeed();
    await settle();
    expect(encoder.started()).toEqual([guestA, user, guestB]);
  });

  it('picks up a job enqueued after it started, on wake or on its next poll', async () => {
    const running = worker();
    running.start();
    await settle();

    const woken = await enqueue();
    await running.wake();
    await settle();
    expect(encoder.started()).toEqual([woken]);

    const polled = await enqueue();
    await jest.advanceTimersByTimeAsync(VIDEO_JOB_POLL_MS);
    await settle();
    expect(encoder.started()).toEqual([woken, polled]);
  });
});

describe('the video job worker: leases', () => {
  it('keeps renewing the lease of a long encode, so it is never requeued', async () => {
    const id = await enqueue();
    worker().start();
    await settle();

    await jest.advanceTimersByTimeAsync(10 * VIDEO_JOB_LEASE_MS);
    await settle();

    const job = (await store.get(id))!;
    expect(job).toMatchObject({ status: 'running', attempts: 1 });
    expect(job.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(encoder.pending).toHaveLength(1);
  });

  it('requeues a job whose worker died, and fails it when its second worker dies too', async () => {
    const id = await enqueue();
    // A worker that claimed the job and then died: nothing renews its lease.
    await store.claimNext({
      now: new Date(),
      leaseUntil: new Date(Date.now() + VIDEO_JOB_LEASE_MS),
      claimId: 'dead-worker',
      includeGuests: true,
    });

    // The second worker loses its database connection for its heartbeats, as a hung
    // process would.
    let heartbeatsFail = false;
    const flaky: VideoJobStore = {
      ...store,
      renewLease: (...args) => (heartbeatsFail ? Promise.reject(new Error('connection lost')) : store.renewLease(...args)),
    };
    worker({ store: flaky }).start();
    await jest.advanceTimersByTimeAsync(VIDEO_JOB_LEASE_MS + VIDEO_JOB_POLL_MS);
    await settle();

    expect(await store.get(id)).toMatchObject({ status: 'running', attempts: 2 });
    expect(encoder.started()).toEqual([id]);

    heartbeatsFail = true;
    const observer = worker({ slots: 0 });
    observer.start();
    await jest.advanceTimersByTimeAsync(VIDEO_JOB_LEASE_MS + VIDEO_JOB_HEARTBEAT_MS);
    await settle();

    expect(await store.get(id)).toMatchObject({ status: 'failed', error: WORKER_STOPPED_MESSAGE, inputKey: null });
    expect(storage.keys()).toEqual([]);
    expect(ended.map((job) => [job.id, job.status])).toEqual([[id, 'failed']]);

    // The worker that lost the job finishes its encode, but changes nothing.
    encoder.encodeOf(id).succeed();
    await settle();
    expect(await status(id)).toBe('failed');
    expect(storage.keys()).toEqual([]);
  });
});

describe('the video job worker: outcomes and files', () => {
  it('stores the output, records the result and deletes the input when a job is done', async () => {
    const id = await enqueue();
    worker().start();
    await settle();
    encoder.encodeOf(id).succeed(Buffer.from('tiny'));
    await settle();

    const job = (await store.get(id))!;
    expect(job).toMatchObject({
      status: 'done',
      inputKey: null,
      outputKey: `video-jobs/${id}/output.mp4`,
      outputSize: 4,
      compressed: true,
      outputFormat: MP4,
    });
    expect(job.resultExpiresAt!.getTime() - job.finishedAt!.getTime()).toBe(VIDEO_RESULT_TTL_MS);
    expect(storage.keys()).toEqual([`video-jobs/${id}/output.mp4`]);
    expect(ended.map((j) => j.status)).toEqual(['done']);
  });

  it("keeps the upload's own format when the re-encode was not smaller", async () => {
    const id = await enqueue();
    const keepOriginal = new VideoJobWorker({
      store,
      storage,
      encode: async ({ input }) => ({ bytes: input, compressed: false, format: { extension: 'mov', contentType: 'video/quicktime' } }),
      slots: 2,
      guestSlots: 1,
    });
    workers.push(keepOriginal);
    keepOriginal.start();
    await settle();

    expect(await store.get(id)).toMatchObject({ status: 'done', compressed: false, outputKey: `video-jobs/${id}/output.mov` });
  });

  it("fails a job with the encoder's message, and deletes its input", async () => {
    const id = await enqueue();
    worker().start();
    await settle();
    encoder.encodeOf(id).fail(new VideoJobFailure('This video could not be compressed in time.'));
    await settle();

    expect(await store.get(id)).toMatchObject({ status: 'failed', error: 'This video could not be compressed in time.', inputKey: null });
    expect(storage.keys()).toEqual([]);
    expect(ended.map((j) => [j.status, j.error])).toEqual([['failed', 'This video could not be compressed in time.']]);
  });

  it('fails a job with a generic message when the server is at fault, and logs it', async () => {
    const id = await enqueue();
    worker().start();
    await settle();
    encoder.encodeOf(id).fail(new Error('ffmpeg binary missing'));
    await settle();

    expect(await store.get(id)).toMatchObject({ status: 'failed', error: UNEXPECTED_FAILURE_MESSAGE });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(id), expect.objectContaining({ message: 'ffmpeg binary missing' }));
  });

  it('cancels a queued job: it never runs and its input is deleted', async () => {
    const running = await enqueue();
    const queued = await enqueue();
    const one = worker({ slots: 1 });
    one.start();
    await settle();

    expect(await cancelVideoJob(store, storage, queued, Date.now(), (jobId) => one.abort(jobId))).toMatchObject({ status: 'cancelled' });
    expect(storage.keys()).toEqual([`video-jobs/${running}/input.mp4`]);

    encoder.encodeOf(running).succeed();
    await settle();
    expect(encoder.started()).toEqual([running]);
    expect(await status(queued)).toBe('cancelled');
  });

  it('cancels a running job: the encoder sees the abort, and no files are left', async () => {
    const id = await enqueue();
    const running = worker();
    running.start();
    await settle();

    await cancelVideoJob(store, storage, id, Date.now(), (jobId) => running.abort(jobId));
    await settle();

    expect(encoder.encodeOf(id).signal.aborted).toBe(true);
    expect(await store.get(id)).toMatchObject({ status: 'cancelled', inputKey: null, outputKey: null });
    expect(storage.keys()).toEqual([]);
    expect(ended).toEqual([]);
    expect(running.runningJobIds).toEqual([]);
  });

  it('stops an encode cancelled from another process at its next heartbeat', async () => {
    const id = await enqueue();
    worker().start();
    await settle();

    await cancelVideoJob(store, storage, id, Date.now());
    await jest.advanceTimersByTimeAsync(VIDEO_JOB_HEARTBEAT_MS);
    await settle();

    expect(encoder.encodeOf(id).signal.aborted).toBe(true);
    expect(storage.keys()).toEqual([]);
  });

  it('deletes a finished output when the job was cancelled as it finished', async () => {
    const id = await enqueue();
    worker().start();
    await settle();

    // Cancelled from another process, so this worker is not told before the encode ends.
    await cancelVideoJob(store, storage, id, Date.now());
    encoder.encodeOf(id).succeed();
    await settle();

    expect(await status(id)).toBe('cancelled');
    expect(storage.keys()).toEqual([]);
  });

  it('deletes a result after 24 hours, in its sweep', async () => {
    const id = await enqueue();
    worker().start();
    await settle();
    encoder.encodeOf(id).succeed();
    await settle();
    const outputKey = `video-jobs/${id}/output.mp4`;

    jest.setSystemTime(Date.now() + VIDEO_RESULT_TTL_MS - VIDEO_JOB_SWEEP_MS - 1000);
    await jest.advanceTimersByTimeAsync(VIDEO_JOB_SWEEP_MS);
    await settle();
    expect(storage.keys()).toEqual([outputKey]);

    await jest.advanceTimersByTimeAsync(VIDEO_JOB_SWEEP_MS);
    await settle();
    expect(storage.keys()).toEqual([]);
    expect(await store.get(id)).toMatchObject({ status: 'done', outputKey: null });
  });

  it('retries, in its sweep, an input delete that failed', async () => {
    const id = await enqueue();
    const running = worker();
    running.start();
    await settle();

    storage.failDeletes = true;
    encoder.encodeOf(id).fail(new VideoJobFailure('Too long'));
    await settle();
    expect(storage.keys()).toEqual([`video-jobs/${id}/input.mp4`]);
    expect((await store.get(id))!.inputKey).not.toBeNull();

    storage.failDeletes = false;
    await running.sweep();
    expect(storage.keys()).toEqual([]);
    expect((await store.get(id))!.inputKey).toBeNull();
  });
});

describe('the video job worker: stopping', () => {
  it('stops claiming once stopped, while the job it runs carries on to the end', async () => {
    const running = await enqueue();
    const stoppable = worker();
    stoppable.start();
    await settle();

    stoppable.stop();
    const waiting = await enqueue();
    await stoppable.wake();
    await jest.advanceTimersByTimeAsync(5 * VIDEO_JOB_POLL_MS + VIDEO_JOB_HEARTBEAT_MS);
    await settle();

    expect(encoder.started()).toEqual([running]);
    expect(await status(waiting)).toBe('queued');

    encoder.encodeOf(running).succeed();
    await settle();
    expect(await status(running)).toBe('done');
    expect(encoder.started()).toEqual([running]);
  });

  it('kills every running encode when told to, for a process that is exiting', async () => {
    const [first, second] = [await enqueue(), await enqueue()];
    const exiting = worker();
    exiting.start();
    await settle();

    exiting.abortAll();
    await settle();

    expect(encoder.encodeOf(first).signal.aborted).toBe(true);
    expect(encoder.encodeOf(second).signal.aborted).toBe(true);
  });
});
