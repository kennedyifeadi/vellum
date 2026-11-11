import mongoose from 'mongoose';
import dbConnect from '@/lib/db/mongoose';
import VideoJobModel from '@/models/videoJob';

// The state of Compress Video's background jobs, kept in MongoDB so that a worker in another
// process, or one started after a restart, picks up where this one left off. Nothing here
// imports Next, so the worker can move to its own process unchanged.

export type VideoJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export const ACTIVE_STATUSES: readonly VideoJobStatus[] = ['queued', 'running'];
export const ENDED_STATUSES: readonly VideoJobStatus[] = ['done', 'failed', 'cancelled'];

export interface VideoJobOptions {
  crf: number;
  resolution: string;
}

export interface VideoOutputFormat {
  extension: string;
  contentType: string;
}

export interface VideoJob {
  id: string;
  status: VideoJobStatus;
  ownerId: string;
  guest: boolean;
  callerKey: string;
  plan: string;
  options: VideoJobOptions;
  fileName: string;
  originalSize: number;
  inputKey: string | null;
  outputKey: string | null;
  outputSize: number | null;
  outputFormat: VideoOutputFormat | null;
  compressed: boolean | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  leaseUntil: Date | null;
  claimId: string | null;
  attempts: number;
  resultExpiresAt: Date | null;
}

export type NewVideoJob = Pick<
  VideoJob,
  'id' | 'ownerId' | 'guest' | 'callerKey' | 'plan' | 'options' | 'fileName' | 'originalSize' | 'inputKey'
>;

export interface VideoJobResult {
  outputKey: string;
  outputSize: number;
  outputFormat: VideoOutputFormat;
  compressed: boolean;
}

export interface ClaimRequest {
  now: Date;
  leaseUntil: Date;
  claimId: string;
  /** False while guests already hold their share of this worker's slots. */
  includeGuests: boolean;
}

export interface LeaseExpiry {
  now: Date;
  /** A job claimed this many times is failed, not requeued. */
  maxAttempts: number;
  failMessage: string;
  resultExpiresAt: Date;
}

export interface ExpiredLeases {
  requeued: VideoJob[];
  failed: VideoJob[];
}

export interface CancelledJob {
  previousStatus: VideoJobStatus;
  job: VideoJob;
}

/**
 * Every change of a job's state. Each write that a worker makes on a running job names
 * the claim it holds, so a worker whose lease ran out and was taken over changes nothing.
 */
export interface VideoJobStore {
  create(job: NewVideoJob, now: Date): Promise<VideoJob>;
  get(id: string): Promise<VideoJob | null>;
  findActiveByCaller(callerKey: string): Promise<VideoJob | null>;
  countQueued(): Promise<number>;
  /** How many queued jobs will be claimed before this one. */
  jobsAhead(job: VideoJob): Promise<number>;
  /** Takes the oldest queued job and marks it running, atomically, or returns null. */
  claimNext(request: ClaimRequest): Promise<VideoJob | null>;
  /** False when the job is no longer running under this claim (cancelled or taken over). */
  renewLease(id: string, claimId: string, leaseUntil: Date): Promise<boolean>;
  finish(id: string, claimId: string, result: VideoJobResult, now: Date, resultExpiresAt: Date): Promise<VideoJob | null>;
  fail(id: string, claimId: string, error: string, now: Date, resultExpiresAt: Date): Promise<VideoJob | null>;
  /** Cancels a queued or running job; null when it has already ended or does not exist. */
  cancel(id: string, now: Date, resultExpiresAt: Date): Promise<CancelledJob | null>;
  /** Requeues, or fails once out of attempts, every running job whose lease has run out. */
  expireLeases(expiry: LeaseExpiry): Promise<ExpiredLeases>;
  /** Done jobs whose result has expired and whose output file is still recorded. */
  findExpiredResults(now: Date): Promise<VideoJob[]>;
  /** Ended jobs whose input file is still recorded. */
  findLeftoverInputs(): Promise<VideoJob[]>;
  forgetFiles(id: string, files: { input?: boolean; output?: boolean }): Promise<void>;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

export function isVideoJobId(id: string): boolean {
  return OBJECT_ID.test(id);
}

export function newVideoJobId(): string {
  return new mongoose.Types.ObjectId().toHexString();
}

interface StoredVideoJob {
  _id: mongoose.Types.ObjectId;
  status: VideoJobStatus;
  ownerId: string;
  guest: boolean;
  callerKey: string;
  plan: string;
  options: VideoJobOptions;
  fileName: string;
  originalSize: number;
  inputKey?: string;
  outputKey?: string;
  outputSize?: number;
  outputFormat?: Partial<VideoOutputFormat>;
  compressed?: boolean;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  leaseUntil?: Date;
  claimId?: string;
  attempts: number;
  resultExpiresAt?: Date;
}

function toVideoJob(row: StoredVideoJob): VideoJob {
  const format = row.outputFormat;
  return {
    id: row._id.toHexString(),
    status: row.status,
    ownerId: row.ownerId,
    guest: row.guest,
    callerKey: row.callerKey,
    plan: row.plan,
    options: { crf: row.options.crf, resolution: row.options.resolution },
    fileName: row.fileName,
    originalSize: row.originalSize,
    inputKey: row.inputKey ?? null,
    outputKey: row.outputKey ?? null,
    outputSize: row.outputSize ?? null,
    outputFormat: format?.extension && format.contentType ? { extension: format.extension, contentType: format.contentType } : null,
    compressed: row.compressed ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    leaseUntil: row.leaseUntil ?? null,
    claimId: row.claimId ?? null,
    attempts: row.attempts,
    resultExpiresAt: row.resultExpiresAt ?? null,
  };
}

function orNull(row: StoredVideoJob | null): VideoJob | null {
  return row ? toVideoJob(row) : null;
}

const AFTER = { returnDocument: 'after' } as const;
const CLAIM_FIELDS = { leaseUntil: 1, claimId: 1 } as const;

interface MongoStoreOptions {
  model?: typeof VideoJobModel;
  connect?: () => Promise<unknown>;
}

export function createMongoVideoJobStore({ model = VideoJobModel, connect = dbConnect }: MongoStoreOptions = {}): VideoJobStore {
  const jobs = model;
  const ready = async () => {
    await connect();
  };
  const byId = (id: string) => (isVideoJobId(id) ? new mongoose.Types.ObjectId(id) : null);

  async function endRunning(id: string, claimId: string, set: Record<string, unknown>): Promise<VideoJob | null> {
    await ready();
    const row = await jobs
      .findOneAndUpdate({ _id: byId(id), status: 'running', claimId }, { $set: set, $unset: CLAIM_FIELDS }, AFTER)
      .lean<StoredVideoJob>();
    return orNull(row);
  }

  return {
    async create(job, now) {
      await ready();
      const row = await jobs.create({ ...job, _id: byId(job.id), status: 'queued', attempts: 0, createdAt: now });
      return toVideoJob(row.toObject());
    },

    async get(id) {
      const _id = byId(id);
      if (!_id) return null;
      await ready();
      return orNull(await jobs.findById(_id).lean<StoredVideoJob>());
    },

    async findActiveByCaller(callerKey) {
      await ready();
      return orNull(await jobs.findOne({ callerKey, status: { $in: ACTIVE_STATUSES } }).lean<StoredVideoJob>());
    },

    async countQueued() {
      await ready();
      return jobs.countDocuments({ status: 'queued' });
    },

    async jobsAhead(job) {
      await ready();
      const _id = byId(job.id);
      return jobs.countDocuments({
        status: 'queued',
        $or: [{ createdAt: { $lt: job.createdAt } }, { createdAt: job.createdAt, _id: { $lt: _id } }],
      });
    },

    async claimNext({ now, leaseUntil, claimId, includeGuests }) {
      await ready();
      const row = await jobs
        .findOneAndUpdate(
          includeGuests ? { status: 'queued' } : { status: 'queued', guest: false },
          { $set: { status: 'running', startedAt: now, leaseUntil, claimId }, $inc: { attempts: 1 } },
          { ...AFTER, sort: { createdAt: 1, _id: 1 } },
        )
        .lean<StoredVideoJob>();
      return orNull(row);
    },

    async renewLease(id, claimId, leaseUntil) {
      await ready();
      const result = await jobs.updateOne({ _id: byId(id), status: 'running', claimId }, { $set: { leaseUntil } });
      return result.matchedCount === 1;
    },

    finish(id, claimId, result, now, resultExpiresAt) {
      return endRunning(id, claimId, { status: 'done', ...result, finishedAt: now, resultExpiresAt });
    },

    fail(id, claimId, error, now, resultExpiresAt) {
      return endRunning(id, claimId, { status: 'failed', error, finishedAt: now, resultExpiresAt });
    },

    async cancel(id, now, resultExpiresAt) {
      const _id = byId(id);
      if (!_id) return null;
      await ready();
      const before = await jobs
        .findOneAndUpdate(
          { _id, status: { $in: ACTIVE_STATUSES } },
          { $set: { status: 'cancelled', finishedAt: now, resultExpiresAt }, $unset: CLAIM_FIELDS },
          { returnDocument: 'before' },
        )
        .lean<StoredVideoJob>();
      if (!before) return null;
      const job = toVideoJob(before);
      return {
        previousStatus: job.status,
        job: { ...job, status: 'cancelled', finishedAt: now, resultExpiresAt, leaseUntil: null, claimId: null },
      };
    },

    async expireLeases({ now, maxAttempts, failMessage, resultExpiresAt }) {
      await ready();
      const expired = await jobs.find({ status: 'running', leaseUntil: { $lt: now } }).lean<StoredVideoJob[]>();
      const outcome: ExpiredLeases = { requeued: [], failed: [] };

      for (const row of expired) {
        const stillExpired = { _id: row._id, status: 'running', claimId: row.claimId, leaseUntil: { $lt: now } };
        if (row.attempts >= maxAttempts) {
          const failed = await jobs
            .findOneAndUpdate(
              stillExpired,
              { $set: { status: 'failed', error: failMessage, finishedAt: now, resultExpiresAt }, $unset: CLAIM_FIELDS },
              AFTER,
            )
            .lean<StoredVideoJob>();
          if (failed) outcome.failed.push(toVideoJob(failed));
        } else {
          const requeued = await jobs
            .findOneAndUpdate(stillExpired, { $set: { status: 'queued' }, $unset: { ...CLAIM_FIELDS, startedAt: 1 } }, AFTER)
            .lean<StoredVideoJob>();
          if (requeued) outcome.requeued.push(toVideoJob(requeued));
        }
      }
      return outcome;
    },

    async findExpiredResults(now) {
      await ready();
      const rows = await jobs
        .find({ status: 'done', resultExpiresAt: { $lte: now }, outputKey: { $exists: true } })
        .lean<StoredVideoJob[]>();
      return rows.map(toVideoJob);
    },

    async findLeftoverInputs() {
      await ready();
      const rows = await jobs
        .find({ status: { $in: ENDED_STATUSES }, inputKey: { $exists: true } })
        .lean<StoredVideoJob[]>();
      return rows.map(toVideoJob);
    },

    async forgetFiles(id, { input, output }) {
      const unset: Record<string, 1> = {};
      if (input) unset.inputKey = 1;
      if (output) unset.outputKey = 1;
      if (Object.keys(unset).length === 0) return;
      await ready();
      await jobs.updateOne({ _id: byId(id) }, { $unset: unset });
    },
  };
}
