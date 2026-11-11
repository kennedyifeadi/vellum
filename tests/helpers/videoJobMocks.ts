import { createMemoryVideoJobStore } from './memoryVideoJobStore';

// For jest.mock factories of route tests that send Compress Video uploads without a
// database: jobs go to an in-memory store, which jest.setup.ts discards between tests.

export function memoryVideoJobStoreModule() {
  return {
    ...jest.requireActual('@/lib/video/video-job-store'),
    createMongoVideoJobStore: () => createMemoryVideoJobStore(),
  };
}

/** lib/video/compress with the upload probe passing, and compressVideo as `compressVideo`. */
export function passingVideoProbeModule(compressVideo: jest.Mock = jest.fn()) {
  return {
    ...jest.requireActual('@/lib/video/compress'),
    checkVideoUpload: jest.fn().mockResolvedValue(undefined),
    compressVideo,
  };
}

/** Marks the oldest queued job done, as the worker would, and returns its id. */
export async function finishOldestVideoJob(outputKey = 'video-jobs/finished/output.mp4'): Promise<string> {
  const { store } = (globalThis as { vellumVideoJobs?: { store: import('@/lib/video/video-job-store').VideoJobStore } }).vellumVideoJobs!;
  const now = Date.now();
  const job = await store.claimNext({ now: new Date(now), leaseUntil: new Date(now + 60_000), claimId: 'test', includeGuests: true });
  if (!job) throw new Error('No video job is queued');
  const outputFormat = { extension: 'mp4', contentType: 'video/mp4' };
  await store.finish(job.id, 'test', { outputKey, outputSize: 1, outputFormat, compressed: true }, new Date(now), new Date(now + 60_000));
  return job.id;
}
