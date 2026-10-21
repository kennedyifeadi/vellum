import { ClientError } from '@/lib/convert/errors';
import { pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';
import type { UploadBudget } from '@/lib/http/read-upload';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

const BYTES_PER_MB = 1024 * 1024;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = 60_000;

// Enterprise matches Pro because next.config.ts's proxyClientMaxBodySize (520 MB) cuts
// off any larger body before the route can read it.
const MAX_FILE_SIZE: PlanTierValues<number> = {
  guest: 50 * BYTES_PER_MB,
  Basic: 100 * BYTES_PER_MB,
  Pro: 500 * BYTES_PER_MB,
  Enterprise: 500 * BYTES_PER_MB,
};

// An encode's time follows the video's length, not its size: a 16x16 clip an hour long
// is a few kilobytes. Read by the probe, so it refuses a video before anything is encoded.
const MAX_DURATION_SECONDS: PlanTierValues<number> = {
  guest: 5 * SECONDS_PER_MINUTE,
  Basic: 15 * SECONDS_PER_MINUTE,
  Pro: 30 * SECONDS_PER_MINUTE,
  Enterprise: 60 * SECONDS_PER_MINUTE,
};

// Five times each plan's length cap. With two encodes running, 1080p30 encoded at 0.31x
// realtime on a 4-core i5-10310U (#111), so the longest video a plan allows needs about
// 3.2 times its length; this leaves half as much again. 4K or high-frame-rate video near
// the cap will not finish and is refused with VIDEO_TOO_SLOW_MESSAGE.
const ENCODE_DEADLINE_MS: PlanTierValues<number> = {
  guest: 25 * MS_PER_MINUTE,
  Basic: 75 * MS_PER_MINUTE,
  Pro: 150 * MS_PER_MINUTE,
  Enterprise: 300 * MS_PER_MINUTE,
};

// The probe reads a 500 MB upload in under 2s.
export const PROBE_DEADLINE_MS = 30_000;

export const MAX_CONCURRENT_VIDEO_ENCODES = 2;

// Per encode, so two encodes take at most four cores whatever the machine has. Against
// ffmpeg's automatic choice this made one encode 1.9x slower and two at once 1.4x slower.
export const FFMPEG_THREADS = 2;

export const COMPRESS_VIDEO_BUSY_MESSAGE = pdfToolBusyMessage('Compress Video');

export const VIDEO_TOO_SLOW_MESSAGE =
  'This video could not be compressed in time. A shorter or lower-resolution video may work.';

export interface VideoEncodeLimits {
  maxDurationSeconds: number;
  encodeDeadlineMs: number;
}

export function encodeLimitsForPlan(plan: string | null | undefined): VideoEncodeLimits {
  return {
    maxDurationSeconds: resolvePlanLimit(plan, MAX_DURATION_SECONDS),
    encodeDeadlineMs: resolvePlanLimit(plan, ENCODE_DEADLINE_MS),
  };
}

export function uploadBudgetForPlan(plan: string | null | undefined): UploadBudget {
  const maxBytes = resolvePlanLimit(plan, MAX_FILE_SIZE);
  return {
    maxBytes,
    tooLarge: () => new ClientError(`Your current plan allows videos up to ${maxBytes / BYTES_PER_MB}MB.`),
  };
}

export function assertFileSizeWithinPlan(plan: string | null | undefined, fileSize: number): void {
  const budget = uploadBudgetForPlan(plan);
  if (fileSize > budget.maxBytes) {
    throw budget.tooLarge(fileSize);
  }
}

export function assertDurationWithinLimit(durationSeconds: number, maxDurationSeconds: number): void {
  if (durationSeconds > maxDurationSeconds) {
    throw new ClientError(
      `This video is longer than your current plan allows. Your plan allows videos up to ${maxDurationSeconds / SECONDS_PER_MINUTE} minutes long.`,
    );
  }
}
