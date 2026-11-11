import { createMemoryVideoJobStore } from './helpers/memoryVideoJobStore';

// instrumentation.ts runs once as the server starts. If register() rejected, Next would fail
// every request, /api/health included, so the video worker must never make it reject.

const STORAGE_ERROR =
  'No storage driver is configured. Set STORAGE_DRIVER=s3 with the S3_* variables for the R2 bucket ' +
  "(or STORAGE_DRIVER=local to keep files on this server's disk, which a redeploy deletes).";

jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/video/video-job-store', () => ({
  ...jest.requireActual('@/lib/video/video-job-store'),
  createMongoVideoJobStore: () => createMemoryVideoJobStore(),
}));

const runtime = process.env.NEXT_RUNTIME;
const nodeEnv = process.env.NODE_ENV;
const storageDriver = process.env.STORAGE_DRIVER;

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.NEXT_RUNTIME = 'nodejs';
});

afterEach(() => {
  jest.dontMock('@/lib/video/video-job-service');
  const state = (globalThis as { vellumVideoJobs?: { worker: { stop(): void } | null } }).vellumVideoJobs;
  state?.worker?.stop();
  delete (globalThis as { vellumVideoJobs?: unknown }).vellumVideoJobs;
  process.env.NEXT_RUNTIME = runtime;
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  if (storageDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = storageDriver;
  jest.restoreAllMocks();
});

describe('instrumentation register()', () => {
  it('resolves, and leaves Compress Video off, in production with no storage driver', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.STORAGE_DRIVER;
    const { register } = await import('../instrumentation');

    await expect(register()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(`Compress Video jobs will not run: ${STORAGE_ERROR}`);
    expect((globalThis as { vellumVideoJobs?: { worker: unknown } }).vellumVideoJobs?.worker).toBeNull();
  });

  it('resolves when the worker module itself cannot be loaded', async () => {
    jest.doMock('@/lib/video/video-job-service', () => {
      throw new Error('Cannot find module ffmpeg-static');
    });
    const { register } = await import('../instrumentation');

    await expect(register()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith('Compress Video jobs will not run: Cannot find module ffmpeg-static');
  });

  it('starts the worker when storage is configured', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.STORAGE_DRIVER = 'local';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { register } = await import('../instrumentation');

    await expect(register()).resolves.toBeUndefined();

    expect((globalThis as { vellumVideoJobs?: { worker: { runningJobIds: string[] } | null } }).vellumVideoJobs?.worker?.runningJobIds).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('does nothing outside the Node.js runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('../instrumentation');

    await expect(register()).resolves.toBeUndefined();

    expect((globalThis as { vellumVideoJobs?: unknown }).vellumVideoJobs).toBeUndefined();
  });
});
