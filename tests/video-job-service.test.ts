import { EventEmitter } from 'events';
import { createMemoryStorage, createMemoryVideoJobStore } from './helpers/memoryVideoJobStore';
import { newJob } from './helpers/videoJobStoreContract';

const mockRecordHistory = jest.fn();
jest.mock('@/lib/conversions', () => ({
  recordConversionHistory: (...args: unknown[]) => mockRecordHistory(...args),
}));

const mockFindByIdAndUpdate = jest.fn();
jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findByIdAndUpdate: (...args: unknown[]) => mockFindByIdAndUpdate(...args) },
}));

jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));

let mockStore: ReturnType<typeof createMemoryVideoJobStore>;
jest.mock('@/lib/video/video-job-store', () => {
  const actual = jest.requireActual('@/lib/video/video-job-store');
  return { ...actual, createMongoVideoJobStore: () => mockStore };
});

import type { VideoJob } from '@/lib/video/video-job-store';
import { guestTokenOwns, newGuestToken, reportToOwner, startVideoJobWorker } from '@/lib/video/video-job-service';

const USER_ID = '507f1f77bcf86cd799439011';

function endedJob(overrides: Partial<VideoJob>): VideoJob {
  return {
    ...newJob({ ownerId: USER_ID, fileName: 'holiday.mov', originalSize: 1000 }),
    status: 'done',
    outputKey: 'video-jobs/x/output.mp4',
    outputSize: 400,
    outputFormat: { extension: 'mp4', contentType: 'video/mp4' },
    compressed: true,
    error: null,
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: new Date(),
    leaseUntil: null,
    claimId: null,
    attempts: 1,
    resultExpiresAt: new Date(),
    ...overrides,
  };
}

const pushed = () => mockFindByIdAndUpdate.mock.calls.map(([userId, update]) => [userId, update.$push.notifications.$each[0]]);

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = createMemoryVideoJobStore();
  delete (globalThis as { vellumVideoJobs?: unknown }).vellumVideoJobs;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  const runtime = (globalThis as { vellumVideoJobs?: { worker: { stop(): void } | null } }).vellumVideoJobs;
  runtime?.worker?.stop();
  delete (globalThis as { vellumVideoJobs?: unknown }).vellumVideoJobs;
  jest.restoreAllMocks();
});

describe('guest job tokens', () => {
  it('are 32 random bytes, matched only by their own hash', () => {
    const first = newGuestToken();
    const second = newGuestToken();

    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(first.ownerId).toMatch(/^[0-9a-f]{64}$/);
    expect(first.ownerId).not.toContain(first.token);
    expect(guestTokenOwns(first.token, first.ownerId)).toBe(true);
    expect(guestTokenOwns(second.token, first.ownerId)).toBe(false);
    expect(guestTokenOwns('', first.ownerId)).toBe(false);
    expect(guestTokenOwns(first.token, 'not-a-hash')).toBe(false);
  });
});

describe('telling the owner a job ended', () => {
  it('records a done job in Recent Activity, without its file, and notifies with the download link', async () => {
    const job = endedJob({});

    await reportToOwner(job);

    expect(mockRecordHistory).toHaveBeenCalledWith(USER_ID, 'Compress Video', 'holiday.mov', 1000, { pages: 1, processedSize: 400 });
    expect(pushed()).toEqual([
      [USER_ID, expect.objectContaining({ type: 'success', link: `/api/convert/video-compress/jobs/${job.id}/download`, isRead: false })],
    ]);
    expect(mockFindByIdAndUpdate.mock.calls[0][1].$push.notifications.$slice).toBe(-50);
  });

  it('notifies a failed job with its reason, and records no history', async () => {
    await reportToOwner(endedJob({ status: 'failed', error: 'This video could not be compressed in time.' }));

    expect(mockRecordHistory).not.toHaveBeenCalled();
    expect(pushed()).toEqual([
      [USER_ID, expect.objectContaining({ type: 'error', message: '"holiday.mov": This video could not be compressed in time.' })],
    ]);
    expect(pushed()[0][1].link).toBeUndefined();
  });

  it('still notifies when the history row cannot be written', async () => {
    mockRecordHistory.mockRejectedValueOnce(new Error('mongo timeout'));

    await reportToOwner(endedJob({}));

    expect(pushed()).toHaveLength(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('tells guests nothing, and nobody about a cancelled job', async () => {
    await reportToOwner(endedJob({ guest: true, ownerId: 'f'.repeat(64) }));
    await reportToOwner(endedJob({ status: 'cancelled' }));

    expect(mockRecordHistory).not.toHaveBeenCalled();
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('starting the worker', () => {
  const uri = process.env.MONGODB_URI;
  afterEach(() => {
    process.env.MONGODB_URI = uri;
  });

  function fakeProcess() {
    const events = new EventEmitter();
    return Object.assign(events, { pid: 4242, kill: jest.fn() });
  }

  const holdForever = () => new Promise<never>(() => {});

  it('does not start without a database', () => {
    delete process.env.MONGODB_URI;

    expect(startVideoJobWorker({ storage: createMemoryStorage(), encode: holdForever, processEvents: fakeProcess() })).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('MONGODB_URI'));
  });

  it('starts once per process', () => {
    const events = fakeProcess();
    const first = startVideoJobWorker({ storage: createMemoryStorage(), encode: holdForever, processEvents: events });

    expect(first).not.toBeNull();
    expect(startVideoJobWorker({ storage: createMemoryStorage(), encode: holdForever, processEvents: events })).toBe(first);
    expect(events.listenerCount('SIGTERM')).toBe(1);
  });

  it('stops claiming on SIGTERM, and passes the signal on when nothing else handles it', async () => {
    const events = fakeProcess();
    const storage = createMemoryStorage();
    const worker = startVideoJobWorker({ storage, encode: holdForever, processEvents: events })!;
    await worker.idle();

    events.emit('SIGTERM');
    const job = newJob();
    await storage.put(job.inputKey!, Buffer.from('video'));
    await mockStore.create(job, new Date());
    await worker.wake();

    expect((await mockStore.get(job.id))!.status).toBe('queued');
    expect(events.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
  });

  it('leaves SIGTERM to the server when it has a handler of its own', () => {
    const events = fakeProcess();
    const nextCleanup = jest.fn();
    events.on('SIGTERM', nextCleanup);
    startVideoJobWorker({ storage: createMemoryStorage(), encode: holdForever, processEvents: events });

    events.emit('SIGTERM');

    expect(nextCleanup).toHaveBeenCalled();
    expect(events.kill).not.toHaveBeenCalled();
  });

  it('kills running encodes when the process exits', async () => {
    const events = fakeProcess();
    const storage = createMemoryStorage();
    const signals: AbortSignal[] = [];
    const job = newJob();
    await storage.put(job.inputKey!, Buffer.from('video'));
    await mockStore.create(job, new Date());

    const worker = startVideoJobWorker({
      storage,
      encode: ({ signal }) => {
        signals.push(signal);
        return holdForever();
      },
      processEvents: events,
    })!;
    while (signals.length === 0) await worker.wake();

    events.emit('exit');

    expect(signals[0].aborted).toBe(true);
  });
});
