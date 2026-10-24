import { NextResponse } from 'next/server';
import type { Caller } from '@/lib/auth/caller';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import { clientAddressKey } from '@/lib/http/rate-limit';

/** The slot pools a heavy job can take slots from; see runWorkerJob, runImageJob and runVideoJob. */
export type JobPool = 'pdf-worker' | 'image' | 'video';

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

interface CallerJob {
  callerKey: string;
  guest: boolean;
  pools: readonly JobPool[];
}

// Kept on globalThis so jest.setup.ts can clear it between tests, as it does the rate limits.
const globalForCallerJobs = globalThis as typeof globalThis & { vellumCallerJobs?: Map<symbol, CallerJob> };
const runningJobs = (globalForCallerJobs.vellumCallerJobs ??= new Map<symbol, CallerJob>());

// A guest without a trusted address is counted under the rate limiter's shared key, so
// without CLIENT_IP_HEADER every guest shares one running job.
function callerKeyOf(headers: Headers, { userId }: Caller): string {
  return userId ? `user:${userId}` : `guest:${clientAddressKey(headers)}`;
}

function guestJobsIn(pool: JobPool, jobs: CallerJob[]): number {
  return jobs.filter((job) => job.guest && job.pools.includes(pool)).length;
}

function claimJob(headers: Headers, caller: Caller, pools: readonly JobPool[]): symbol {
  const job: CallerJob = { callerKey: callerKeyOf(headers, caller), guest: !caller.userId, pools };
  const jobs = [...runningJobs.values()];

  if (jobs.some((running) => running.callerKey === job.callerKey)) {
    throw new CallerJobRefusedError('job-in-progress');
  }
  if (job.guest && pools.some((pool) => guestJobsIn(pool, jobs) >= GUEST_SLOTS_PER_POOL)) {
    throw new CallerJobRefusedError('guest-share-full');
  }

  const claim = Symbol(job.callerKey);
  runningJobs.set(claim, job);
  return claim;
}

/**
 * Runs one request's job as its caller's only running job, holding the guests' share of
 * every pool in `pools` when the caller is a guest. Called before the upload is read, so
 * a refused request costs nothing; refuses with `CallerJobRefusedError`. The claim is
 * released however `work` settles.
 */
export async function runCallerJob<Result>(
  req: Request,
  caller: Caller,
  pools: readonly JobPool[],
  work: () => Promise<Result>,
): Promise<Result> {
  const claim = claimJob(req.headers, caller, pools);
  try {
    return await work();
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
