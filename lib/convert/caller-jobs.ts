import { NextResponse } from 'next/server';
import type { Caller } from '@/lib/auth/caller';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import { clientAddressKey } from '@/lib/http/rate-limit';

/** The slot pools a heavy job can take slots from; see runWorkerJob, runImageJob, runVideoJob and runRenderJob. */
export type JobPool = 'pdf-worker' | 'image' | 'video' | 'browser';

// Each pool has two slots. Guests together may hold one of them, so a signed-in user can
// always find a slot that no guest can take.
const GUEST_SLOTS_PER_POOL = 1;

const JOB_IN_PROGRESS_RETRY_AFTER_SECONDS = 5;

export const JOB_IN_PROGRESS_MESSAGE = 'You already have a conversion in progress. Please wait for it to finish.';

export type CallerJobRefusal = 'job-in-progress' | 'guest-share-full';

export class CallerJobRefusedError extends Error {
  readonly refusal: CallerJobRefusal;

  constructor(refusal: CallerJobRefusal) {
    super(
      refusal === 'job-in-progress'
        ? 'The caller already has a job running'
        : 'Guests already hold their share of the slots this job needs',
    );
    this.name = 'CallerJobRefusedError';
    this.refusal = refusal;
  }
}

interface RunningJob {
  callerKey: string;
  guest: boolean;
  /** The pools whose guests' share the job holds: none until its work needs a slot. */
  pools: readonly JobPool[];
}

/** A caller's claimed job, handed to the work it runs. */
export interface CallerJob {
  /**
   * Runs the part of the job that takes pool slots, holding the guests' share of `pools`
   * when the caller is a guest. Called once the upload has been read and checked, so a
   * guest still uploading holds no share; refuses with `CallerJobRefusedError`.
   */
  inPools<Result>(pools: readonly JobPool[], work: () => Promise<Result>): Promise<Result>;
}

// Kept on globalThis so jest.setup.ts can clear it between tests, as it does the rate limits.
const globalForCallerJobs = globalThis as typeof globalThis & { vellumCallerJobs?: Map<symbol, RunningJob> };
const runningJobs = (globalForCallerJobs.vellumCallerJobs ??= new Map<symbol, RunningJob>());

// A guest without a trusted address is counted under the rate limiter's shared key, so
// without CLIENT_IP_HEADER every guest shares one running job.
function callerKeyOf(headers: Headers, { userId }: Caller): string {
  return userId ? `user:${userId}` : `guest:${clientAddressKey(headers)}`;
}

function claimJob(headers: Headers, caller: Caller): { claim: symbol; job: RunningJob } {
  const job: RunningJob = { callerKey: callerKeyOf(headers, caller), guest: !caller.userId, pools: [] };

  if ([...runningJobs.values()].some((running) => running.callerKey === job.callerKey)) {
    throw new CallerJobRefusedError('job-in-progress');
  }

  const claim = Symbol(job.callerKey);
  runningJobs.set(claim, job);
  return { claim, job };
}

function guestJobsIn(pool: JobPool): number {
  return [...runningJobs.values()].filter((job) => job.guest && job.pools.includes(pool)).length;
}

async function runInPools<Result>(job: RunningJob, pools: readonly JobPool[], work: () => Promise<Result>): Promise<Result> {
  if (!job.guest) {
    return work();
  }
  if (pools.some((pool) => guestJobsIn(pool) >= GUEST_SLOTS_PER_POOL)) {
    throw new CallerJobRefusedError('guest-share-full');
  }

  job.pools = pools;
  try {
    return await work();
  } finally {
    job.pools = [];
  }
}

/**
 * Runs one request's job as its caller's only running job. Called before the upload is
 * read, so a caller refused for already running one costs nothing; refuses with
 * `CallerJobRefusedError`. The claim, and any guests' share taken through the job, is
 * released however `work` settles.
 */
export async function runCallerJob<Result>(
  req: Request,
  caller: Caller,
  work: (job: CallerJob) => Promise<Result>,
): Promise<Result> {
  const { claim, job } = claimJob(req.headers, caller);
  try {
    return await work({ inPools: (pools, inner) => runInPools(job, pools, inner) });
  } finally {
    runningJobs.delete(claim);
  }
}

/** A guest refused its share is told the tool is busy, as when every slot is taken. */
export function callerJobRefusedResponse(error: CallerJobRefusedError, busyMessage: string): NextResponse {
  if (error.refusal === 'guest-share-full') {
    return busyResponse(busyMessage);
  }
  return NextResponse.json(
    { error: JOB_IN_PROGRESS_MESSAGE },
    { status: 429, headers: { 'Retry-After': String(JOB_IN_PROGRESS_RETRY_AFTER_SECONDS) } },
  );
}
