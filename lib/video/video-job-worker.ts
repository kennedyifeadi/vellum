import { randomUUID } from 'crypto';
import type { StorageDriver } from '@/lib/storage/types';
import { ENDED_STATUSES, type VideoJob, type VideoJobStore, type VideoOutputFormat } from '@/lib/video/video-job-store';

// Runs Compress Video's queued jobs in this process. It imports nothing from Next, and all
// it shares with other processes is the store and the storage, so it can move to a process
// of its own unchanged.

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;

// A running job's lease, renewed on every heartbeat. If the process dies, the job is
// requeued once the lease runs out: a minute after the last heartbeat at most. Three
// heartbeats fit in a lease, so one slow or failed database write does not lose it.
export const VIDEO_JOB_LEASE_MS = 60 * SECOND_MS;
export const VIDEO_JOB_HEARTBEAT_MS = 20 * SECOND_MS;

// Enqueuing wakes the worker at once; the poll only picks up what that missed, such as a
// job requeued by an expired lease or enqueued by another process.
export const VIDEO_JOB_POLL_MS = 3 * SECOND_MS;
export const VIDEO_JOB_SWEEP_MS = 5 * 60 * SECOND_MS;

// A job whose worker died twice is failed rather than tried a third time: the video itself
// may be what kills it.
export const VIDEO_JOB_MAX_ATTEMPTS = 2;

/** How long a finished job's result is kept for download (an owner decision, #115). */
export const VIDEO_RESULT_TTL_MS = 24 * HOUR_MS;

export const WORKER_STOPPED_MESSAGE =
  'This video could not be compressed because the server restarted while it was being compressed. Please try again.';
export const UNEXPECTED_FAILURE_MESSAGE = 'This video could not be compressed. Please try again.';

/** An encode failure whose message is written for the job's owner. */
export class VideoJobFailure extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VideoJobFailure';
  }
}

export interface EncodedVideo {
  bytes: Buffer;
  compressed: boolean;
  format: VideoOutputFormat;
}

export interface VideoEncodeRequest {
  job: VideoJob;
  input: Buffer;
  signal: AbortSignal;
}

/** Encodes one job's input. Throws VideoJobFailure for a reason the owner should see. */
export type VideoEncoder = (request: VideoEncodeRequest) => Promise<EncodedVideo>;

export interface VideoJobWorkerOptions {
  store: VideoJobStore;
  storage: StorageDriver;
  encode: VideoEncoder;
  /** Told about every job that ends done or failed (not cancelled). */
  onJobEnded?: (job: VideoJob) => Promise<void>;
  slots: number;
  /** How many of the slots guests may hold at once. */
  guestSlots: number;
  now?: () => number;
}

export function videoJobInputKey(jobId: string, extension: string): string {
  return `video-jobs/${jobId}/input${extension}`;
}

export function videoJobOutputKey(jobId: string, extension: string): string {
  return `video-jobs/${jobId}/output.${extension}`;
}

export function resultExpiry(now: number): Date {
  return new Date(now + VIDEO_RESULT_TTL_MS);
}

async function deleteQuietly(storage: StorageDriver, key: string): Promise<boolean> {
  try {
    await storage.delete(key);
    return true;
  } catch (error) {
    console.error(`Failed to delete video job file ${key}:`, error);
    return false;
  }
}

/** Deletes an ended job's input and stops recording it; a failure is left for the sweep. */
export async function discardInput(store: VideoJobStore, storage: StorageDriver, job: VideoJob): Promise<void> {
  if (job.inputKey && (await deleteQuietly(storage, job.inputKey))) {
    await store.forgetFiles(job.id, { input: true });
  }
}

/**
 * Cancels a queued or running job and deletes its input. `abort` stops the encode when
 * this process runs it; a worker elsewhere finds out on its next heartbeat.
 */
export async function cancelVideoJob(
  store: VideoJobStore,
  storage: StorageDriver,
  id: string,
  now: number,
  abort: (jobId: string) => void = () => {},
): Promise<VideoJob | null> {
  const cancelled = await store.cancel(id, new Date(now), resultExpiry(now));
  if (!cancelled) return null;

  abort(id);
  await discardInput(store, storage, cancelled.job);
  return cancelled.job;
}

interface RunningEncode {
  job: VideoJob;
  controller: AbortController;
}

export class VideoJobWorker {
  private readonly store: VideoJobStore;
  private readonly storage: StorageDriver;
  private readonly encode: VideoEncoder;
  private readonly onJobEnded?: (job: VideoJob) => Promise<void>;
  private readonly slots: number;
  private readonly guestSlots: number;
  private readonly now: () => number;

  private readonly running = new Map<string, RunningEncode>();
  private readonly settling = new Set<Promise<void>>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private stopped = false;
  private tickInFlight: Promise<void> | null = null;
  private tickAgain = false;

  constructor(options: VideoJobWorkerOptions) {
    this.store = options.store;
    this.storage = options.storage;
    this.encode = options.encode;
    this.onJobEnded = options.onJobEnded;
    this.slots = options.slots;
    this.guestSlots = options.guestSlots;
    this.now = options.now ?? Date.now;
  }

  /** Starts polling for jobs and sweeping expired results. Timers never hold the process open. */
  start(): void {
    this.timers.push(setInterval(() => this.wake(), VIDEO_JOB_POLL_MS).unref());
    this.timers.push(setInterval(() => void this.sweep(), VIDEO_JOB_SWEEP_MS).unref());
    this.wake();
    void this.sweep();
  }

  /**
   * Stops claiming jobs. Jobs already running carry on, with their heartbeats, for as long
   * as the process lives; if it exits first their leases run out and they are requeued.
   */
  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  get runningJobIds(): string[] {
    return [...this.running.keys()];
  }

  /** Looks for work now, as when a job was just enqueued or a slot just freed. */
  wake(): Promise<void> {
    if (this.tickInFlight) {
      this.tickAgain = true;
      return this.tickInFlight;
    }
    this.tickInFlight = this.tick().finally(() => {
      this.tickInFlight = null;
      if (this.tickAgain) {
        this.tickAgain = false;
        void this.wake();
      }
    });
    return this.tickInFlight;
  }

  /** Stops one running job's encode, as when its owner cancels it. */
  abort(jobId: string): void {
    this.running.get(jobId)?.controller.abort();
  }

  /** Stops every running encode, so no ffmpeg outlives the process. */
  abortAll(): void {
    for (const { controller } of this.running.values()) controller.abort();
  }

  /** Resolves once no claim is in progress and every job running now has settled. */
  async idle(): Promise<void> {
    while (this.tickInFlight || this.settling.size > 0) {
      await Promise.all([this.tickInFlight, ...this.settling]);
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.expireLeases();
      while (!this.stopped && this.running.size < this.slots) {
        const job = await this.claim();
        if (!job) break;
        this.launch(job);
      }
    } catch (error) {
      console.error('Video job worker could not claim jobs:', error);
    }
  }

  private async claim(): Promise<VideoJob | null> {
    const now = this.now();
    const runningGuests = [...this.running.values()].filter(({ job }) => job.guest).length;
    return this.store.claimNext({
      now: new Date(now),
      leaseUntil: new Date(now + VIDEO_JOB_LEASE_MS),
      claimId: randomUUID(),
      includeGuests: runningGuests < this.guestSlots,
    });
  }

  private async expireLeases(): Promise<void> {
    const now = this.now();
    const { failed } = await this.store.expireLeases({
      now: new Date(now),
      maxAttempts: VIDEO_JOB_MAX_ATTEMPTS,
      failMessage: WORKER_STOPPED_MESSAGE,
      resultExpiresAt: resultExpiry(now),
    });
    for (const job of failed) {
      await discardInput(this.store, this.storage, job);
      await this.report(job);
    }
  }

  private launch(job: VideoJob): void {
    const controller = new AbortController();
    this.running.set(job.id, { job, controller });
    const heartbeat = setInterval(() => void this.heartbeat(job, controller), VIDEO_JOB_HEARTBEAT_MS).unref();

    const settled = this.run(job, controller.signal).finally(() => {
      clearInterval(heartbeat);
      this.running.delete(job.id);
      this.settling.delete(settled);
      void this.wake();
    });
    this.settling.add(settled);
  }

  private async heartbeat(job: VideoJob, controller: AbortController): Promise<void> {
    try {
      const held = await this.store.renewLease(job.id, job.claimId!, new Date(this.now() + VIDEO_JOB_LEASE_MS));
      if (!held) controller.abort();
    } catch (error) {
      console.error(`Could not renew the lease of video job ${job.id}:`, error);
    }
  }

  private async run(job: VideoJob, signal: AbortSignal): Promise<void> {
    let ended: VideoJob | null;
    let outputKey: string | null = null;
    try {
      const output = await this.encodeInput(job, signal);
      outputKey = videoJobOutputKey(job.id, output.format.extension);
      await this.storage.put(outputKey, output.bytes);
      ended = await this.store.finish(
        job.id,
        job.claimId!,
        { outputKey, outputSize: output.bytes.length, outputFormat: output.format, compressed: output.compressed },
        new Date(this.now()),
        resultExpiry(this.now()),
      );
    } catch (error) {
      ended = await this.failQuietly(job, error);
    }

    if (!ended && outputKey) {
      await deleteQuietly(this.storage, outputKey);
    }
    await this.discardInputIfEnded(job, ended);
    if (ended) await this.report(ended);
  }

  private async encodeInput(job: VideoJob, signal: AbortSignal): Promise<EncodedVideo> {
    const input = job.inputKey ? await this.storage.get(job.inputKey) : null;
    if (signal.aborted) {
      throw new VideoJobFailure('The job was cancelled.');
    }
    if (!input) {
      throw new Error(`The input of video job ${job.id} is missing from storage`);
    }
    return this.encode({ job, input, signal });
  }

  private async failQuietly(job: VideoJob, error: unknown): Promise<VideoJob | null> {
    if (!(error instanceof VideoJobFailure)) {
      console.error(`Video job ${job.id} failed:`, error);
    }
    const message = error instanceof VideoJobFailure ? error.message : UNEXPECTED_FAILURE_MESSAGE;
    try {
      return await this.store.fail(job.id, job.claimId!, message, new Date(this.now()), resultExpiry(this.now()));
    } catch (storeError) {
      console.error(`Could not record the failure of video job ${job.id}:`, storeError);
      return null;
    }
  }

  // A job this worker no longer holds was either cancelled, so its input goes, or taken
  // over after its lease ran out, so another run still needs it.
  private async discardInputIfEnded(job: VideoJob, ended: VideoJob | null): Promise<void> {
    try {
      const current = ended ?? (await this.store.get(job.id));
      if (!current || ENDED_STATUSES.includes(current.status)) {
        await discardInput(this.store, this.storage, job);
      }
    } catch (error) {
      console.error(`Could not discard the input of video job ${job.id}:`, error);
    }
  }

  private async report(job: VideoJob): Promise<void> {
    if (!this.onJobEnded) return;
    try {
      await this.onJobEnded(job);
    } catch (error) {
      console.error(`Could not report the end of video job ${job.id}:`, error);
    }
  }

  /** Deletes expired results, and inputs a failed delete left behind. */
  async sweep(): Promise<void> {
    try {
      const now = new Date(this.now());
      for (const job of await this.store.findExpiredResults(now)) {
        if (job.outputKey && (await deleteQuietly(this.storage, job.outputKey))) {
          await this.store.forgetFiles(job.id, { output: true });
        }
      }
      for (const job of await this.store.findLeftoverInputs()) {
        await discardInput(this.store, this.storage, job);
      }
    } catch (error) {
      console.error('Video job sweep failed:', error);
    }
  }
}
