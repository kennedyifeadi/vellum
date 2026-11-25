import { EventEmitter } from 'events';
import { NextRequest } from 'next/server';
import type { StorageDriver } from '@/lib/storage/types';
import { newVideoJobId, type VideoJob } from '@/lib/video/video-job-store';
import type { EncodedVideo, VideoJobWorker } from '@/lib/video/video-job-worker';
import type { MemoryModel } from './helpers/memoryModel';
import { createMemoryVideoJobStore } from './helpers/memoryVideoJobStore';
import { STORAGE_DRIVERS, type DriverUnderTest } from './helpers/storageDrivers';
import { newJob } from './helpers/videoJobStoreContract';

const USER = '507f1f77bcf86cd799439011';
const OTHER_USER = '507f1f77bcf86cd799439022';
const HOUR_MS = 60 * 60 * 1000;
const MP4 = { extension: 'mp4', contentType: 'video/mp4' };
const DELETED_MESSAGE = 'Account deleted, with its conversion history, stored documents and compressed videos';
const PENDING_MESSAGE = 'Account deleted. Some of its files could not be deleted yet, so deleting them will be retried.';
const OTHER_USERS_FILES = ['docs/their-doc.pdf', 'theirs.pdf'];

let mockStorage: StorageDriver | Error;
let mockStore: ReturnType<typeof createMemoryVideoJobStore>;
const mockDeleteCookie = jest.fn();

jest.mock('@aws-sdk/client-s3', () => jest.requireActual('./helpers/fakeS3').fakeS3Module());
jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn(() => Promise.resolve('507f1f77bcf86cd799439011')) }));
jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('next/headers', () => ({ cookies: jest.fn(() => Promise.resolve({ delete: mockDeleteCookie })) }));
jest.mock('@/lib/storage', () => ({
  getStorage: () => {
    if (mockStorage instanceof Error) throw mockStorage;
    return mockStorage;
  },
  LocalDiskStorage: class {},
}));
jest.mock('@/lib/notifications', () => ({ pushNotification: jest.fn().mockResolvedValue({}) }));
jest.mock('@/lib/video/video-job-store', () => ({
  ...jest.requireActual('@/lib/video/video-job-store'),
  createMongoVideoJobStore: () => mockStore,
}));
jest.mock('@/models/user', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/conversion', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());
jest.mock('@/models/userDocument', () => jest.requireActual('./helpers/memoryModel').memoryModelModule());

import User from '@/models/user';
import Conversion from '@/models/conversion';
import UserDocument from '@/models/userDocument';
import { startVideoJobWorker } from '@/lib/video/video-job-service';
import { GET as jobStatus } from '../app/api/convert/video-compress/jobs/[id]/route';
import { DELETE as deleteAccount } from '../app/api/user/delete/route';

const users = User as unknown as MemoryModel;
const conversions = Conversion as unknown as MemoryModel;
const documents = UserDocument as unknown as MemoryModel;

jest.setTimeout(30_000);

function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => (resolve = done));
  return { promise, resolve };
}

const request = (method = 'DELETE') => new NextRequest('http://localhost:3000/api/user/delete', { method });
const ownedBy = (model: MemoryModel, userId: string) => model.all().filter((row) => row.userId === userId);
const jobsOf = (ownerId: string): VideoJob[] => mockStore.all().filter((job) => job.ownerId === ownerId);

describe.each(STORAGE_DRIVERS)('DELETE /api/user/delete on %s', (_name, createDriver) => {
  let driver: DriverUnderTest;
  let worker: VideoJobWorker | null;

  beforeEach(async () => {
    driver = createDriver();
    mockStorage = driver.storage;
    mockStore = createMemoryVideoJobStore();
    worker = null;
    mockDeleteCookie.mockClear();
    for (const model of [users, conversions, documents]) model.reset();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    users.seed({ _id: USER, plan: 'Basic' });
    users.seed({ _id: OTHER_USER, plan: 'Basic' });
    const expiresAt = new Date(Date.now() + HOUR_MS);
    conversions.seed({ userId: USER, diskFileName: 'mine.pdf', expiresAt });
    conversions.seed({ userId: USER, fileName: 'history-only.pdf', expiresAt });
    conversions.seed({ userId: OTHER_USER, diskFileName: 'theirs.pdf', expiresAt });
    documents.seed({ userId: USER, diskFileName: 'my-doc.pdf', expiresAt });
    documents.seed({ userId: OTHER_USER, diskFileName: 'their-doc.pdf', expiresAt });
    for (const key of ['mine.pdf', 'theirs.pdf', 'docs/my-doc.pdf', 'docs/their-doc.pdf']) {
      await driver.storage.put(key, Buffer.from(key));
    }
  });

  afterEach(() => {
    worker?.stop();
    worker?.abortAll();
    jest.restoreAllMocks();
    driver.close();
  });

  async function queueJob(ownerId = USER, guest = false) {
    const id = newVideoJobId();
    const job = newJob({ id, ownerId, guest });
    await driver.storage.put(job.inputKey!, Buffer.from('input'));
    await mockStore.create(job, new Date());
    return id;
  }

  function claimOldest(claimId: string) {
    const now = new Date();
    return mockStore.claimNext({ now, leaseUntil: new Date(now.getTime() + HOUR_MS), claimId, includeGuests: true });
  }

  async function finish(id: string, claimId: string) {
    const outputKey = `video-jobs/${id}/output.mp4`;
    await driver.storage.put(outputKey, Buffer.from('output'));
    const result = { outputKey, outputSize: 6, outputFormat: MP4, compressed: true };
    await mockStore.finish(id, claimId, result, new Date(), new Date(Date.now() + 24 * HOUR_MS));
  }

  async function doneJob(ownerId = USER, guest = false) {
    const id = await queueJob(ownerId, guest);
    await claimOldest(`claim-${id}`);
    await finish(id, `claim-${id}`);
    return id;
  }

  const processEvents = () => Object.assign(new EventEmitter(), { pid: 1, kill: () => true });

  /** This process's worker, with an encode that ends when the test says, or when aborted. */
  function startWorker() {
    const started = deferred();
    const encoded = deferred<EncodedVideo>();
    let signal: AbortSignal | undefined;
    worker = startVideoJobWorker({
      storage: driver.storage,
      processEvents: processEvents(),
      encode: (encoding) => {
        signal = encoding.signal;
        started.resolve();
        return new Promise((resolve, reject) => {
          encoding.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          void encoded.promise.then(resolve);
        });
      },
    });
    return {
      started: started.promise,
      succeed: () => encoded.resolve({ bytes: Buffer.from('output'), compressed: true, format: MP4 }),
      aborted: () => signal?.aborted,
    };
  }

  /** A worker whose put of its job's output waits until the test lets it through. */
  async function workerStoringOutput() {
    const id = await queueJob();
    const outputKey = `video-jobs/${id}/output.mp4`;
    const storing = deferred();
    const held = deferred();
    const put = driver.storage.put.bind(driver.storage);
    jest.spyOn(driver.storage, 'put').mockImplementation(async (key, data) => {
      if (key === outputKey) {
        storing.resolve();
        await held.promise;
      }
      await put(key, data);
    });
    const encode = startWorker();
    await encode.started;
    encode.succeed();
    await storing.promise;
    return { outputKey, letThrough: held.resolve };
  }

  it("removes the user's conversions, documents and files, and leaves other users' alone", async () => {
    const res = await deleteAccount(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: DELETED_MESSAGE });
    for (const name of ['auth-token', 'next-auth.session-token', '__Secure-next-auth.session-token']) {
      expect(mockDeleteCookie).toHaveBeenCalledWith(expect.objectContaining({ name }));
    }
    expect(ownedBy(conversions, USER)).toEqual([]);
    expect(ownedBy(documents, USER)).toEqual([]);
    expect(users.all().map((user) => user._id)).toEqual([OTHER_USER]);
    expect(driver.keys()).toEqual(OTHER_USERS_FILES);
    expect(ownedBy(conversions, OTHER_USER)).toHaveLength(1);
    expect(ownedBy(documents, OTHER_USER)).toHaveLength(1);
  });

  it('deletes rows that had expired but were not swept yet', async () => {
    conversions.seed({ userId: USER, diskFileName: 'expired.pdf', expiresAt: new Date(Date.now() - HOUR_MS) });
    await driver.storage.put('expired.pdf', Buffer.from('expired'));

    await deleteAccount(request());

    expect(driver.has('expired.pdf')).toBe(false);
    expect(ownedBy(conversions, USER)).toEqual([]);
  });

  it('removes a queued job and its input', async () => {
    await queueJob();

    await deleteAccount(request());

    expect(jobsOf(USER)).toEqual([]);
    expect(driver.keys()).toEqual(OTHER_USERS_FILES);
  });

  it('removes a job another process is running, which can no longer finish it', async () => {
    const id = await queueJob();
    await claimOldest('elsewhere');

    await deleteAccount(request());

    expect(jobsOf(USER)).toEqual([]);
    expect(await mockStore.renewLease(id, 'elsewhere', new Date(Date.now() + HOUR_MS))).toBe(false);
    expect(driver.keys()).toEqual(OTHER_USERS_FILES);
  });

  it('kills the encode this process is running', async () => {
    await queueJob();
    const encode = startWorker();
    await encode.started;

    await deleteAccount(request());

    expect(encode.aborted()).toBe(true);
    await worker!.idle();
    expect(jobsOf(USER)).toEqual([]);
    expect(driver.keys()).toEqual(OTHER_USERS_FILES);
  });

  it('removes a done job, input and output', async () => {
    await doneJob();

    await deleteAccount(request());

    expect(jobsOf(USER)).toEqual([]);
    expect(driver.keys()).toEqual(OTHER_USERS_FILES);
  });

  it("removes a failed or cancelled job's leftover input", async () => {
    const failed = await queueJob();
    await claimOldest('claim-failed');
    await mockStore.fail(failed, 'claim-failed', 'Too slow', new Date(), new Date(Date.now() + HOUR_MS));
    const cancelled = await queueJob();
    await mockStore.cancel(cancelled, new Date(), new Date(Date.now() + HOUR_MS));

    await deleteAccount(request());

    expect(jobsOf(USER)).toEqual([]);
    expect(driver.keys()).toEqual(OTHER_USERS_FILES);
  });

  it('removes a job that finishes just before it would have been cancelled', async () => {
    const id = await queueJob();
    await claimOldest('finishing');
    const updateMany = conversions.updateMany;
    jest.spyOn(conversions, 'updateMany').mockImplementationOnce(async (filter, update) => {
      await finish(id, 'finishing');
      return updateMany(filter, update);
    });

    await deleteAccount(request());

    expect(jobsOf(USER)).toEqual([]);
    expect(driver.keys()).toEqual(OTHER_USERS_FILES);
  });

  it('removes what was stored while the account was being deleted', async () => {
    const remove = users.findByIdAndDelete;
    jest.spyOn(users, 'findByIdAndDelete').mockImplementationOnce((id) => {
      conversions.seed({ userId: USER, diskFileName: 'late.pdf', expiresAt: new Date(Date.now() + HOUR_MS) });
      void driver.storage.put('late.pdf', Buffer.from('late'));
      return remove(id);
    });

    await deleteAccount(request());

    expect(ownedBy(conversions, USER)).toEqual([]);
    expect(driver.keys()).toEqual(OTHER_USERS_FILES);
  });

  it('removes the output a worker was storing while the account was deleted', async () => {
    const { outputKey, letThrough } = await workerStoringOutput();

    await deleteAccount(request());
    letThrough();
    await worker!.idle();

    expect(driver.has(outputKey)).toBe(false);
    expect(jobsOf(USER)).toEqual([]);
    expect(ownedBy(conversions, USER)).toEqual([]);
  });

  it("records that worker's output when it cannot delete it, for its sweep to retry", async () => {
    const { outputKey, letThrough } = await workerStoringOutput();

    await deleteAccount(request());
    driver.failDeleteOf(outputKey);
    letThrough();
    await worker!.idle();

    expect(jobsOf(USER)).toEqual([expect.objectContaining({ outputKey, resultExpiresAt: null })]);

    driver.allowDeletes();
    await worker!.sweep();

    expect(driver.has(outputKey)).toBe(false);
    expect(jobsOf(USER)).toEqual([]);
  });

  it("leaves other users' and guests' jobs alone", async () => {
    const theirs = await doneJob(OTHER_USER);
    const guests = await doneJob(USER, true);

    await deleteAccount(request());

    expect(mockStore.all().map((job) => job.id).sort()).toEqual([theirs, guests].sort());
    expect(driver.has(`video-jobs/${theirs}/output.mp4`)).toBe(true);
    expect(driver.has(`video-jobs/${guests}/output.mp4`)).toBe(true);
  });

  it.each([
    ['conversion', 'mine.pdf', () => ownedBy(conversions, USER)],
    ['document', 'docs/my-doc.pdf', () => ownedBy(documents, USER)],
  ])('keeps an expired record of a %s file it cannot delete, and does not claim it is gone', async (_what, key, rowsLeft) => {
    driver.failDeleteOf(key);

    const res = await deleteAccount(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: PENDING_MESSAGE, filesPending: true });
    expect(users.all().map((user) => user._id)).toEqual([OTHER_USER]);
    expect(driver.has(key)).toBe(true);
    const left = rowsLeft();
    expect(left).toHaveLength(1);
    expect(left[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(key), expect.any(Error));
  });

  it.each(['input.mp4', 'output.mp4'])('keeps a job whose %s cannot be deleted out of the TTL, until the sweep deletes it', async (file) => {
    const id = await doneJob();
    const key = `video-jobs/${id}/${file}`;
    driver.failDeleteOf(key);

    const res = await deleteAccount(request());

    expect(await res.json()).toEqual({ message: PENDING_MESSAGE, filesPending: true });
    // The TTL index is on resultExpiresAt, and passes over a row without one.
    expect(jobsOf(USER)).toEqual([expect.objectContaining({ id, resultExpiresAt: null })]);
    expect((await jobStatus(request('GET'), { params: Promise.resolve({ id }) })).status).toBe(404);

    driver.allowDeletes();
    worker = startVideoJobWorker({ storage: driver.storage, processEvents: processEvents() });
    await worker!.sweep();

    expect(driver.has(key)).toBe(false);
    expect(jobsOf(USER)).toEqual([]);
  });

  it('answers pending, not failed, when the database fails after the account is gone', async () => {
    const remove = users.findByIdAndDelete;
    jest.spyOn(users, 'findByIdAndDelete').mockImplementationOnce((id) => {
      jest.spyOn(conversions, 'updateMany').mockRejectedValue(new Error('connection lost'));
      return remove(id);
    });

    const res = await deleteAccount(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: PENDING_MESSAGE, filesPending: true });
    // Expired before the account went, so the sweep deletes them.
    for (const row of ownedBy(conversions, USER)) expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('changes nothing when storage cannot be set up', async () => {
    mockStorage = new Error('No storage driver is configured.');

    expect((await deleteAccount(request())).status).toBe(500);
    expect(users.all()).toHaveLength(2);
    for (const row of ownedBy(conversions, USER)) expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
