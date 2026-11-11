import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { Caller } from '@/lib/auth/caller';
import { callerKeyOf, GUEST_SLOTS_PER_POOL } from '@/lib/convert/caller-jobs';
import { ClientError } from '@/lib/convert/errors';
import { encodeLimitsForPlan, MAX_CONCURRENT_VIDEO_ENCODES } from '@/lib/convert/video-compress-limits';
import { recordConversionHistory } from '@/lib/conversions';
import { pushNotification } from '@/lib/notifications';
import { getStorage, type StorageDriver } from '@/lib/storage';
import { compressVideo, inputExtension } from '@/lib/video/compress';
import {
  createMongoVideoJobStore,
  newVideoJobId,
  type VideoJob,
  type VideoJobOptions,
  type VideoJobStore,
} from '@/lib/video/video-job-store';
import {
  cancelVideoJob as cancelJob,
  VideoJobFailure,
  VideoJobWorker,
  videoJobInputKey,
  type VideoEncoder,
} from '@/lib/video/video-job-worker';

// Compress Video's background jobs as the app runs them: the MongoDB store, the configured
// storage, ffmpeg, and the owner told when a job ends. Routes reach the worker through here.

export const VIDEO_JOB_TOKEN_HEADER = 'X-Job-Token';
const GUEST_TOKEN_BYTES = 32;

interface VideoJobsRuntime {
  store: VideoJobStore;
  worker: VideoJobWorker | null;
}

// On globalThis, because instrumentation.ts and the route handlers can be separate bundles
// with separate copies of this module, and they must share one worker.
const globalForVideoJobs = globalThis as typeof globalThis & { vellumVideoJobs?: VideoJobsRuntime };

function runtime(): VideoJobsRuntime {
  return (globalForVideoJobs.vellumVideoJobs ??= { store: createMongoVideoJobStore(), worker: null });
}

export function videoJobStore(): VideoJobStore {
  return runtime().store;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** One active job per caller, keyed like the per-caller claims but stored only as a hash. */
export function videoJobCallerKey(headers: Headers, caller: Caller): string {
  return sha256(callerKeyOf(headers, caller));
}

/** A guest's proof of ownership of one job. Only its hash is stored. */
export function newGuestToken(): { token: string; ownerId: string } {
  const token = randomBytes(GUEST_TOKEN_BYTES).toString('base64url');
  return { token, ownerId: sha256(token) };
}

export function guestTokenOwns(token: string, ownerId: string): boolean {
  const given = Buffer.from(sha256(token), 'hex');
  const stored = Buffer.from(ownerId, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}

export const encodeWithFfmpeg: VideoEncoder = async ({ job, input, signal }) => {
  try {
    return await compressVideo({
      inputBuffer: input,
      fileName: job.fileName,
      crf: job.options.crf,
      resolution: job.options.resolution,
      ...encodeLimitsForPlan(job.plan),
      signal,
    });
  } catch (error) {
    if (error instanceof ClientError) {
      throw new VideoJobFailure(error.message, { cause: error });
    }
    throw error;
  }
};

export function videoJobDownloadPath(jobId: string): string {
  return `/api/convert/video-compress/jobs/${jobId}/download`;
}

async function attempt(what: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`Failed to ${what}:`, error);
  }
}

/** Records a signed-in owner's finished job in Recent Activity and notifies them. Guests get neither. */
export async function reportToOwner(job: VideoJob): Promise<void> {
  if (job.guest) return;

  if (job.status === 'done') {
    await attempt('record Compress Video conversion', () =>
      recordConversionHistory(job.ownerId, 'Compress Video', job.fileName, job.originalSize, {
        pages: 1,
        processedSize: job.outputSize,
      }),
    );
    await attempt('notify the owner of a compressed video', () =>
      pushNotification(job.ownerId, {
        type: 'success',
        title: 'Video compressed',
        message: `"${job.fileName}" is ready. You can download it for 24 hours.`,
        link: videoJobDownloadPath(job.id),
      }),
    );
  } else if (job.status === 'failed') {
    await attempt('notify the owner of a failed video', () =>
      pushNotification(job.ownerId, {
        type: 'error',
        title: 'Video not compressed',
        message: `"${job.fileName}": ${job.error}`,
      }),
    );
  }
}

/** The parts of `process` the worker's shutdown handling uses. */
export interface ProcessEvents {
  pid: number;
  once(event: 'SIGTERM' | 'exit', listener: () => void): unknown;
  listenerCount(event: 'SIGTERM'): number;
  kill(pid: number, signal: 'SIGTERM'): unknown;
}

interface WorkerDeps {
  storage?: StorageDriver;
  encode?: VideoEncoder;
  processEvents?: ProcessEvents;
}

export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts this process's worker, once. It runs during server startup, so it never throws:
 * without a database, or when the storage or anything else it needs cannot be set up, it
 * logs why Compress Video jobs will not run and returns null, and the rest of the app serves
 * as usual. On SIGTERM it stops claiming jobs and leaves shutdown to Next; when the process
 * exits, any encode still running is killed, and its job is requeued once its lease runs out.
 */
export function startVideoJobWorker({ storage, encode = encodeWithFfmpeg, processEvents = process }: WorkerDeps = {}): VideoJobWorker | null {
  const state = runtime();
  if (state.worker) return state.worker;
  if (!process.env.MONGODB_URI) {
    console.warn('Compress Video jobs will not run: MONGODB_URI is not set.');
    return null;
  }

  try {
    const worker = new VideoJobWorker({
      store: state.store,
      storage: storage ?? getStorage(),
      encode,
      onJobEnded: reportToOwner,
      slots: MAX_CONCURRENT_VIDEO_ENCODES,
      guestSlots: GUEST_SLOTS_PER_POOL,
    });
    worker.start();
    state.worker = worker;
    stopOnShutdown(worker, processEvents);
    return worker;
  } catch (error) {
    console.error(`Compress Video jobs will not run: ${reasonOf(error)}`);
    return null;
  }
}

function stopOnShutdown(worker: VideoJobWorker, processEvents: ProcessEvents): void {
  processEvents.once('SIGTERM', () => {
    worker.stop();
    // A listener of our own would otherwise stop SIGTERM ending a process nothing else handles it for.
    if (processEvents.listenerCount('SIGTERM') === 0) processEvents.kill(processEvents.pid, 'SIGTERM');
  });
  processEvents.once('exit', () => worker.abortAll());
}

export interface UploadedVideo {
  caller: Caller;
  callerKey: string;
  ownerId: string;
  fileName: string;
  options: VideoJobOptions;
  input: Buffer;
}

/** Stores the upload and queues its job, then wakes the worker. */
export async function enqueueVideoJob(
  { caller, callerKey, ownerId, fileName, options, input }: UploadedVideo,
  storage: StorageDriver = getStorage(),
): Promise<VideoJob> {
  const id = newVideoJobId();
  const inputKey = videoJobInputKey(id, inputExtension(fileName));
  await storage.put(inputKey, input);

  let job: VideoJob;
  try {
    job = await videoJobStore().create(
      { id, ownerId, guest: !caller.userId, callerKey, plan: caller.plan, options, fileName, originalSize: input.length, inputKey },
      new Date(),
    );
  } catch (error) {
    await attempt(`delete the input of video job ${id}`, () => storage.delete(inputKey));
    throw error;
  }

  void runtime().worker?.wake();
  return job;
}

/** Cancels a queued or running job: its encode is killed and its input deleted. */
export function cancelVideoJob(id: string, storage: StorageDriver = getStorage()): Promise<VideoJob | null> {
  const { store, worker } = runtime();
  return cancelJob(store, storage, id, Date.now(), (jobId) => worker?.abort(jobId));
}
