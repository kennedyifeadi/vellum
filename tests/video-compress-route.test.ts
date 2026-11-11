import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { ClientError } from '@/lib/convert/errors';
import { createMemoryStorage, createMemoryVideoJobStore } from './helpers/memoryVideoJobStore';
import { newJob } from './helpers/videoJobStoreContract';
import { trackedFile } from './helpers/storedFileStreams';

let mockUserId: string | null = null;
let mockPlan = 'Free';
let mockResolvedFiles: any[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockUserId ? { plan: mockPlan } : null)),
  },
}));

const conversionCreate = jest.fn().mockResolvedValue(true);
jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: (...args: any[]) => conversionCreate(...args) },
}));

let mockStorage: ReturnType<typeof createMemoryStorage>;
const mockGetStorage = jest.fn(() => mockStorage);
jest.mock('@/lib/storage', () => ({
  getStorage: () => mockGetStorage(),
  LocalDiskStorage: class {},
}));

let mockStore: ReturnType<typeof createMemoryVideoJobStore>;
jest.mock('@/lib/video/video-job-store', () => {
  const actual = jest.requireActual('@/lib/video/video-job-store');
  return { ...actual, createMongoVideoJobStore: () => mockStore };
});

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const checkVideoUpload = jest.fn();
jest.mock('@/lib/video/compress', () => ({
  ...jest.requireActual('@/lib/video/compress'),
  checkVideoUpload: (...args: any[]) => checkVideoUpload(...args),
}));

import { POST as handleVideoCompress } from '../app/api/convert/video-compress/route';
import { DELETE as cancelJob, GET as jobStatus } from '../app/api/convert/video-compress/jobs/[id]/route';
import { GET as downloadJob } from '../app/api/convert/video-compress/jobs/[id]/download/route';
import { JOB_IN_PROGRESS_MESSAGE } from '@/lib/convert/caller-jobs';
import { COMPRESS_VIDEO_BUSY_MESSAGE, MAX_QUEUED_VIDEO_JOBS, tooMuchWorkMessage } from '@/lib/convert/video-compress-limits';
import { newVideoJobId } from '@/lib/video/video-job-store';

const USER_A = '507f1f77bcf86cd799439011';
const USER_B = '507f1f77bcf86cd799439022';
const MB = 1024 * 1024;
const MP4 = { extension: 'mp4', contentType: 'video/mp4' };

function fakeFile(buffer: Buffer, name = 'clip.mp4', type = 'video/mp4') {
  return {
    name,
    type,
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function oversizedFile(size: number, name = 'clip.mp4') {
  return {
    name,
    type: 'video/mp4',
    size,
    arrayBuffer: jest.fn().mockRejectedValue(new Error('an over-cap upload must not be read')),
  };
}

function videoRequest(fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return new NextRequest('http://localhost:3000/api/convert/video-compress', { method: 'POST', body });
}

function jobRequest(id: string, { token, method = 'GET', path = '' }: { token?: string; method?: string; path?: string } = {}) {
  return new NextRequest(`http://localhost:3000/api/convert/video-compress/jobs/${id}${path}`, {
    method,
    headers: token ? { 'X-Job-Token': token } : {},
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

// The user id is read as the request starts, so it can be put back once the call returns.
async function as<Result>(userId: string | null, send: () => Promise<Result>): Promise<Result> {
  const previous = mockUserId;
  mockUserId = userId;
  try {
    return await send();
  } finally {
    mockUserId = previous;
  }
}

async function upload(fields: Record<string, string> = {}, file: any = fakeFile(Buffer.from('raw-input'))) {
  mockResolvedFiles = [file];
  const res = await handleVideoCompress(videoRequest(fields));
  return { res, body: await res.json() };
}

const claimOldest = (claimId = 'c') =>
  mockStore.claimNext({ now: new Date(), leaseUntil: new Date(Date.now() + 60_000), claimId, includeGuests: true });

/** Moves a job to done as the worker would, with `bytes` as its output. */
async function finishJob(id: string, bytes = Buffer.from('small'), format = MP4, resultExpiresAt = new Date(Date.now() + 60_000)) {
  expect((await claimOldest(`claim-${id}`))?.id).toBe(id);
  const outputKey = `video-jobs/${id}/output.${format.extension}`;
  await mockStorage.put(outputKey, bytes);
  await mockStore.finish(id, `claim-${id}`, { outputKey, outputSize: bytes.length, outputFormat: format, compressed: true }, new Date(), resultExpiresAt);
  const inputKey = (await mockStore.get(id))!.inputKey!;
  await mockStorage.delete(inputKey);
  await mockStore.forgetFiles(id, { input: true });
}

const fakeWorker = { wake: jest.fn().mockResolvedValue(undefined), abort: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  checkVideoUpload.mockReset().mockResolvedValue(undefined);
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  mockStorage = createMemoryStorage();
  mockStore = createMemoryVideoJobStore();
  (globalThis as { vellumVideoJobs?: unknown }).vellumVideoJobs = { store: mockStore, worker: fakeWorker };
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as { vellumVideoJobs?: unknown }).vellumVideoJobs;
  jest.restoreAllMocks();
});

describe('video-compress upload', () => {
  it('stores the upload, queues a job for a signed-in user and answers 202 at once', async () => {
    mockUserId = USER_A;
    mockPlan = 'Basic';

    const { res, body } = await upload({ quality: 'High', resolution: '720p' }, fakeFile(Buffer.from('raw-input'), 'holiday.mov'));

    expect(res.status).toBe(202);
    expect(body).toEqual({ jobId: expect.stringMatching(/^[0-9a-f]{24}$/), status: 'queued' });
    expect(await mockStore.get(body.jobId)).toMatchObject({
      status: 'queued',
      ownerId: USER_A,
      guest: false,
      plan: 'Basic',
      options: { crf: 23, resolution: '720p' },
      fileName: 'holiday.mov',
      originalSize: 9,
      inputKey: `video-jobs/${body.jobId}/input.mov`,
    });
    expect((await mockStorage.get(`video-jobs/${body.jobId}/input.mov`))?.toString()).toBe('raw-input');
    expect(fakeWorker.wake).toHaveBeenCalled();
    expect(conversionCreate).not.toHaveBeenCalled();
  });

  it('gives a guest a 32-byte token, and stores only its hash', async () => {
    const { res, body } = await upload();

    expect(res.status).toBe(202);
    expect(Buffer.from(body.token, 'base64url')).toHaveLength(32);
    const job = (await mockStore.get(body.jobId))!;
    expect(job).toMatchObject({ guest: true, plan: 'Free' });
    expect(job.ownerId).toBe(createHash('sha256').update(body.token).digest('hex'));
    expect(JSON.stringify(mockStore.all())).not.toContain(body.token);
  });

  it.each([
    ['High', 23],
    ['Medium', 28],
    ['Low', 32],
    [undefined, 28],
  ])('maps quality %s to CRF %i, and the resolution defaults to Original', async (quality, crf) => {
    const { body } = await upload(quality ? { quality } : {});

    expect((await mockStore.get(body.jobId))!.options).toEqual({ crf, resolution: 'Original' });
  });

  it.each([
    ['a guest', null, 'Free', 5, 5],
    ['Basic', USER_A, 'Basic', 15, 15],
    ['Pro', USER_A, 'Pro', 30, 30],
    ['Enterprise', USER_A, 'Enterprise', 60, 60],
  ])("probes %s's upload against its own length cap and encode budget", async (_label, userId, plan, videoMinutes, budgetMinutes) => {
    mockUserId = userId;
    mockPlan = plan;
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
    const req = videoRequest({ resolution: '480p' });

    await handleVideoCompress(req);

    expect(checkVideoUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'clip.mp4',
        resolution: '480p',
        maxDurationSeconds: videoMinutes * 60,
        timeBudgetMs: budgetMinutes * 60_000,
        signal: req.signal,
      }),
    );
    expect(checkVideoUpload.mock.calls[0][0].inputBuffer.toString()).toBe('raw-input');
  });

  it.each([
    ['too much work', tooMuchWorkMessage(82, '720p')],
    ['an unreadable file', 'That file could not be read as a video.'],
    ['an empty file', 'The video file is empty.'],
    ['a video over the length cap', 'This video is longer than your current plan allows. Your plan allows videos up to 5 minutes long.'],
  ])('refuses %s at upload with the same message as before, queuing nothing', async (_label, message) => {
    checkVideoUpload.mockRejectedValueOnce(new ClientError(message));

    const { res, body } = await upload();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: message });
    expect(mockStore.all()).toEqual([]);
    expect(mockStorage.keys()).toEqual([]);
  });

  it('answers 500 and keeps no file when the job cannot be created', async () => {
    jest.spyOn(mockStore, 'create').mockRejectedValueOnce(new Error('mongo timeout'));

    const { res, body } = await upload();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to compress video' });
    expect(mockStorage.keys()).toEqual([]);
  });

  it('answers 500 when the job store is unreachable, before reading the upload', async () => {
    jest.spyOn(mockStore, 'findActiveByCaller').mockRejectedValueOnce(new Error('MongoServerSelectionError'));
    const file = fakeFile(Buffer.from('raw-input'));

    const { res } = await upload({}, file);

    expect(res.status).toBe(500);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('refuses the upload with the storage error, before reading it, when no storage is configured', async () => {
    mockGetStorage.mockImplementationOnce(() => {
      throw new Error('No storage driver is configured. Set STORAGE_DRIVER=s3 with the S3_* variables for the R2 bucket.');
    });
    const file = fakeFile(Buffer.from('raw-input'));

    const { res, body } = await upload({}, file);

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBeNull();
    expect(body).toEqual({
      error: 'Compress Video is unavailable: No storage driver is configured. Set STORAGE_DRIVER=s3 with the S3_* variables for the R2 bucket.',
    });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(mockStore.all()).toEqual([]);
  });

  it('answers 400 when no video was sent', async () => {
    mockResolvedFiles = [];

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No video provided');
  });
});

describe('video-compress one active job per caller', () => {
  it.each([
    ['a signed-in user', USER_A],
    ['a guest', null],
  ])('refuses %s a second upload while the first is queued, before reading it', async (_label, userId) => {
    mockUserId = userId;
    await upload();
    const second = fakeFile(Buffer.from('second'));

    const { res, body } = await upload({}, second);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(body).toEqual({ error: JOB_IN_PROGRESS_MESSAGE });
    expect(second.arrayBuffer).not.toHaveBeenCalled();
    expect(mockStore.all()).toHaveLength(1);
  });

  it('refuses it while the first is running, and accepts it once the first has ended', async () => {
    mockUserId = USER_A;
    const { body: first } = await upload();
    await claimOldest();

    expect((await upload()).res.status).toBe(429);

    await mockStore.finish(first.jobId, 'c', { outputKey: 'k', outputSize: 1, outputFormat: MP4, compressed: true }, new Date(), new Date(Date.now() + 1000));
    expect((await upload()).res.status).toBe(202);
  });

  it('does not stop another user', async () => {
    await as(USER_A, () => upload());

    expect((await as(USER_B, () => upload())).res.status).toBe(202);
  });
});

describe('video-compress queue cap', () => {
  async function fillQueue(count: number) {
    for (let i = 0; i < count; i++) {
      await mockStore.create(newJob({ callerKey: `someone-${i}` }), new Date(Date.now() - 1000 + i));
    }
  }

  it(`accepts the upload that makes ${MAX_QUEUED_VIDEO_JOBS} queued jobs`, async () => {
    await fillQueue(MAX_QUEUED_VIDEO_JOBS - 1);

    expect((await upload()).res.status).toBe(202);
  });

  it('answers 503 busy with Retry-After when the queue is full, before reading the upload', async () => {
    await fillQueue(MAX_QUEUED_VIDEO_JOBS);
    const file = fakeFile(Buffer.from('raw-input'));

    const { res, body } = await upload({}, file);

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect(body).toEqual({ error: COMPRESS_VIDEO_BUSY_MESSAGE });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('does not count running jobs against the cap', async () => {
    await fillQueue(MAX_QUEUED_VIDEO_JOBS);
    await claimOldest();

    expect((await upload()).res.status).toBe(202);
  });
});

describe('video-compress size caps', () => {
  it.each([
    ['a guest', null, 'Free', 50],
    ['an unknown plan', USER_A, 'Platinum', 50],
    ['a Basic user', USER_A, 'Basic', 100],
    ['a Pro user', USER_A, 'Pro', 500],
    ['an Enterprise user', USER_A, 'Enterprise', 500],
  ])('refuses %s a video over the plan cap, before reading it', async (_label, userId, plan, capMb) => {
    mockUserId = userId;
    mockPlan = plan;
    const file = oversizedFile(capMb * MB + 1);

    const { res, body } = await upload({}, file);

    expect(res.status).toBe(400);
    expect(body.error).toBe(`Your current plan allows videos up to ${capMb}MB.`);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(checkVideoUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['a guest', null, 'Free', 50],
    ['an Enterprise user', USER_A, 'Enterprise', 500],
  ])('accepts %s a video exactly at the cap', async (_label, userId, plan, capMb) => {
    mockUserId = userId;
    mockPlan = plan;

    const { res } = await upload({}, { ...fakeFile(Buffer.from('raw-input')), size: capMb * MB });

    expect(res.status).toBe(202);
  });
});

describe('video-compress job status', () => {
  it('tells a queued job how many jobs are ahead of it', async () => {
    await as(USER_B, () => upload());
    const { body } = await as(USER_A, () => upload({}, fakeFile(Buffer.from('raw-input'), 'mine.mp4')));

    const res = await as(USER_A, () => jobStatus(jobRequest(body.jobId), params(body.jobId)));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'queued', position: 1, fileName: 'mine.mp4', originalSize: 9 });
  });

  it('reports a done job with its sizes and saving', async () => {
    const { body } = await as(USER_A, () => upload({}, fakeFile(Buffer.alloc(1000), 'clip.mp4')));
    await finishJob(body.jobId, Buffer.alloc(250));

    const res = await as(USER_A, () => jobStatus(jobRequest(body.jobId), params(body.jobId)));

    expect(await res.json()).toEqual({
      status: 'done',
      fileName: 'clip.mp4',
      originalSize: 1000,
      compressedSize: 250,
      savedPercent: 75,
      compressed: true,
      expiresAt: expect.any(String),
    });
  });

  it('reports a failed job with its reason', async () => {
    const { body } = await as(USER_A, () => upload());
    await claimOldest();
    await mockStore.fail(body.jobId, 'c', 'This video could not be compressed in time.', new Date(), new Date());

    const res = await as(USER_A, () => jobStatus(jobRequest(body.jobId), params(body.jobId)));

    expect(await res.json()).toMatchObject({ status: 'failed', error: 'This video could not be compressed in time.' });
  });

  it("answers a guest's own token, and nothing else", async () => {
    const { body } = await upload();
    const other = await as(USER_B, () => upload());

    expect((await jobStatus(jobRequest(body.jobId, { token: body.token }), params(body.jobId))).status).toBe(200);
    expect((await jobStatus(jobRequest(body.jobId, { token: `${body.token}x` }), params(body.jobId))).status).toBe(404);
    expect((await jobStatus(jobRequest(body.jobId), params(body.jobId))).status).toBe(404);
    expect((await as(USER_B, () => jobStatus(jobRequest(body.jobId), params(body.jobId)))).status).toBe(404);
    // A guest's token proves nothing about a signed-in user's job.
    expect((await jobStatus(jobRequest(other.body.jobId, { token: body.token }), params(other.body.jobId))).status).toBe(404);
  });

  it('answers a signed-in owner by session alone, and anyone else 404, the same as for no job', async () => {
    const { body } = await as(USER_A, () => upload());
    const missing = newVideoJobId();

    const answers = [
      await as(USER_B, () => jobStatus(jobRequest(body.jobId), params(body.jobId))),
      await as(null, () => jobStatus(jobRequest(body.jobId), params(body.jobId))),
      await as(USER_A, () => jobStatus(jobRequest(missing), params(missing))),
      await as(USER_A, () => jobStatus(jobRequest('not-an-id'), params('not-an-id'))),
    ];

    expect((await as(USER_A, () => jobStatus(jobRequest(body.jobId), params(body.jobId)))).status).toBe(200);
    expect(answers.map((res) => res.status)).toEqual([404, 404, 404, 404]);
    const bodies = await Promise.all(answers.map((res) => res.json()));
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });
});

describe('video-compress job download', () => {
  const download = (id: string, token?: string) => downloadJob(jobRequest(id, { token, path: '/download' }), params(id));

  it('sends the compressed video with the same name and headers as before', async () => {
    const { body } = await as(USER_A, () => upload({}, fakeFile(Buffer.alloc(1000), 'holiday.mp4')));
    await finishJob(body.jobId, Buffer.from('fake-mp4-payload'));

    const res = await as(USER_A, () => download(body.jobId));

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fake-mp4-payload');
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="compressed_holiday.mp4"; filename*=UTF-8''compressed_holiday.mp4`);
    expect(res.headers.get('X-Original-Size')).toBe('1000');
    expect(res.headers.get('X-Compressed-Size')).toBe('16');
    expect(res.headers.get('X-Saved-Percent')).toBe('98');
    expect(res.headers.get('Content-Length')).toBe('16');
  });

  it('streams the result from storage without reading the whole file first', async () => {
    const { body } = await as(USER_A, () => upload({}, fakeFile(Buffer.alloc(1000), 'holiday.mp4')));
    await finishJob(body.jobId, Buffer.from('fake-mp4-payload'));
    jest.spyOn(mockStorage, 'get').mockRejectedValue(new Error('a download must not read the whole file'));

    const res = await as(USER_A, () => download(body.jobId));

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fake-mp4-payload');
  });

  it('releases the stored result when the client disconnects mid-download', async () => {
    const { body } = await as(USER_A, () => upload());
    await finishJob(body.jobId, Buffer.from('fake-mp4-payload'));
    const file = trackedFile(Buffer.from('fake-mp4-payload'));
    jest.spyOn(mockStorage, 'openRead').mockResolvedValue(file);
    const client = new AbortController();
    const request = new NextRequest(`http://localhost:3000/api/convert/video-compress/jobs/${body.jobId}/download`, {
      signal: client.signal,
    });

    const res = await as(USER_A, () => downloadJob(request, params(body.jobId)));
    await res.body!.getReader().read();
    client.abort();

    await expect(file.cancelled).resolves.toBeUndefined();
  });

  it('sends an original that was not made smaller with its own type, name and a 0% saving', async () => {
    const original = Buffer.from('original-mov-bytes');
    const { body } = await upload({}, fakeFile(original, 'holiday.mov', 'video/quicktime'));
    await finishJob(body.jobId, original, { extension: 'mov', contentType: 'video/quicktime' });

    const res = await download(body.jobId, body.token);

    expect(res.headers.get('Content-Type')).toBe('video/quicktime');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="compressed_holiday.mov"; filename*=UTF-8''compressed_holiday.mov`);
    expect(res.headers.get('X-Saved-Percent')).toBe('0');
  });

  it('answers 409 before the job is done', async () => {
    const { body } = await as(USER_A, () => upload());

    expect((await as(USER_A, () => download(body.jobId))).status).toBe(409);
  });

  it('answers 410 once the result has expired, even before the sweep has deleted it', async () => {
    const { body } = await as(USER_A, () => upload());
    await finishJob(body.jobId, Buffer.from('mp4'), MP4, new Date(Date.now() - 1000));

    const res = await as(USER_A, () => download(body.jobId));

    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/24 hours/);
  });

  it('answers 410 when the sweep has deleted the result', async () => {
    const { body } = await as(USER_A, () => upload());
    await finishJob(body.jobId);
    await mockStorage.delete(`video-jobs/${body.jobId}/output.mp4`);
    await mockStore.forgetFiles(body.jobId, { output: true });

    expect((await as(USER_A, () => download(body.jobId))).status).toBe(410);
  });

  it('answers 404 to anyone but the owner', async () => {
    const { body } = await upload();
    await finishJob(body.jobId);

    expect((await download(body.jobId)).status).toBe(404);
    expect((await as(USER_A, () => download(body.jobId))).status).toBe(404);
    expect((await download(body.jobId, body.token)).status).toBe(200);
  });
});

describe('video-compress job cancel', () => {
  const cancel = (id: string, token?: string) => cancelJob(jobRequest(id, { token, method: 'DELETE' }), params(id));

  it('cancels a queued job, deletes its input, and lets the caller upload again', async () => {
    const { body } = await as(USER_A, () => upload());

    const res = await as(USER_A, () => cancel(body.jobId));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'cancelled' });
    expect((await mockStore.get(body.jobId))!.status).toBe('cancelled');
    expect(mockStorage.keys()).toEqual([]);
    expect((await as(USER_A, () => upload())).res.status).toBe(202);
  });

  it("cancels a running job and stops this process's encode of it", async () => {
    const { body } = await upload();
    await claimOldest();

    const res = await cancel(body.jobId, body.token);

    expect(await res.json()).toEqual({ status: 'cancelled' });
    expect(fakeWorker.abort).toHaveBeenCalledWith(body.jobId);
    expect(mockStorage.keys()).toEqual([]);
  });

  it('leaves a job that has already ended as it is', async () => {
    const { body } = await as(USER_A, () => upload());
    await finishJob(body.jobId);

    const res = await as(USER_A, () => cancel(body.jobId));

    expect(await res.json()).toEqual({ status: 'done' });
    expect(mockStorage.keys()).toEqual([`video-jobs/${body.jobId}/output.mp4`]);
  });

  it("answers 404, and cancels nothing, for someone else's job", async () => {
    const { body } = await as(USER_A, () => upload());
    const guest = await upload();

    expect((await as(USER_B, () => cancel(body.jobId))).status).toBe(404);
    expect((await cancel(body.jobId, guest.body.token)).status).toBe(404);
    expect((await mockStore.get(body.jobId))!.status).toBe('queued');
    expect(fakeWorker.abort).not.toHaveBeenCalled();
  });
});
