import {
  ACTIVE_STATUSES,
  ENDED_STATUSES,
  isVideoJobId,
  type VideoJob,
  type VideoJobStore,
} from '@/lib/video/video-job-store';
import type { StorageDriver } from '@/lib/storage/types';

// The same state changes as createMongoVideoJobStore, on a Map, so the worker can be tested
// without a database. tests/helpers/videoJobStoreContract.ts runs the same cases against
// both, so the two stay in step.

function inQueueOrder(a: VideoJob, b: VideoJob): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

export function createMemoryVideoJobStore(): VideoJobStore & { all(): VideoJob[] } {
  const jobs = new Map<string, VideoJob>();
  const copy = (job: VideoJob | undefined | null): VideoJob | null =>
    job ? { ...job, options: { ...job.options }, outputFormat: job.outputFormat && { ...job.outputFormat } } : null;
  const update = (job: VideoJob, changes: Partial<VideoJob>): VideoJob => {
    const next = { ...job, ...changes };
    jobs.set(job.id, next);
    return copy(next)!;
  };
  const runningUnder = (id: string, claimId: string) => {
    const job = jobs.get(id);
    return job && job.status === 'running' && job.claimId === claimId ? job : null;
  };

  return {
    all: () => [...jobs.values()].map((job) => copy(job)!),

    async create(job, now) {
      const created: VideoJob = {
        ...job,
        status: 'queued',
        outputKey: null,
        outputSize: null,
        outputFormat: null,
        compressed: null,
        error: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        leaseUntil: null,
        claimId: null,
        attempts: 0,
        resultExpiresAt: null,
      };
      jobs.set(job.id, created);
      return copy(created)!;
    },

    async get(id) {
      return isVideoJobId(id) ? copy(jobs.get(id)) : null;
    },

    async findActiveByCaller(callerKey) {
      return copy([...jobs.values()].find((job) => job.callerKey === callerKey && ACTIVE_STATUSES.includes(job.status)));
    },

    async countQueued() {
      return [...jobs.values()].filter((job) => job.status === 'queued').length;
    },

    async jobsAhead(job) {
      return [...jobs.values()].filter((other) => other.status === 'queued' && inQueueOrder(other, job) < 0).length;
    },

    async claimNext({ now, leaseUntil, claimId, includeGuests }) {
      const next = [...jobs.values()]
        .filter((job) => job.status === 'queued' && (includeGuests || !job.guest))
        .sort(inQueueOrder)[0];
      if (!next) return null;
      return update(next, { status: 'running', startedAt: now, leaseUntil, claimId, attempts: next.attempts + 1 });
    },

    async renewLease(id, claimId, leaseUntil) {
      const job = runningUnder(id, claimId);
      if (job) update(job, { leaseUntil });
      return Boolean(job);
    },

    async finish(id, claimId, result, now, resultExpiresAt) {
      const job = runningUnder(id, claimId);
      return job
        ? update(job, { status: 'done', ...result, finishedAt: now, resultExpiresAt, leaseUntil: null, claimId: null })
        : null;
    },

    async fail(id, claimId, error, now, resultExpiresAt) {
      const job = runningUnder(id, claimId);
      return job
        ? update(job, { status: 'failed', error, finishedAt: now, resultExpiresAt, leaseUntil: null, claimId: null })
        : null;
    },

    async cancel(id, now, resultExpiresAt) {
      const job = jobs.get(id);
      if (!job || !ACTIVE_STATUSES.includes(job.status)) return null;
      const previousStatus = job.status;
      return {
        previousStatus,
        job: update(job, { status: 'cancelled', finishedAt: now, resultExpiresAt, leaseUntil: null, claimId: null }),
      };
    },

    async expireLeases({ now, maxAttempts, failMessage, resultExpiresAt }) {
      const outcome = { requeued: [] as VideoJob[], failed: [] as VideoJob[] };
      for (const job of [...jobs.values()]) {
        if (job.status !== 'running' || !job.leaseUntil || job.leaseUntil >= now) continue;
        if (job.attempts >= maxAttempts) {
          outcome.failed.push(
            update(job, { status: 'failed', error: failMessage, finishedAt: now, resultExpiresAt, leaseUntil: null, claimId: null }),
          );
        } else {
          outcome.requeued.push(update(job, { status: 'queued', startedAt: null, leaseUntil: null, claimId: null }));
        }
      }
      return outcome;
    },

    async findExpiredResults(now) {
      return [...jobs.values()]
        .filter((job) => job.status === 'done' && job.outputKey && job.resultExpiresAt && job.resultExpiresAt <= now)
        .map((job) => copy(job)!);
    },

    async findLeftoverInputs() {
      return [...jobs.values()]
        .filter((job) => ENDED_STATUSES.includes(job.status) && job.inputKey)
        .map((job) => copy(job)!);
    },

    async forgetFiles(id, { input, output }) {
      const job = jobs.get(id);
      if (!job) return;
      update(job, { ...(input ? { inputKey: null } : {}), ...(output ? { outputKey: null } : {}) });
    },
  };
}

/** A StorageDriver on a Map, which can be told to fail deletes. */
export function createMemoryStorage(): StorageDriver & { keys(): string[]; failDeletes: boolean } {
  const files = new Map<string, Buffer>();
  return {
    failDeletes: false,
    keys: () => [...files.keys()].sort(),
    async put(key, data) {
      files.set(key, Buffer.from(data));
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async openRead(key) {
      const bytes = files.get(key);
      return bytes ? { stream: new Blob([new Uint8Array(bytes)]).stream(), size: bytes.length } : null;
    },
    async delete(key) {
      if (this.failDeletes) throw new Error(`delete of ${key} failed`);
      files.delete(key);
    },
    async exists(key) {
      return files.has(key);
    },
  };
}
