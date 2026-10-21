import { ClientError } from '@/lib/convert/errors';
import { pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';
import type { UploadBudget } from '@/lib/http/read-upload';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

const BYTES_PER_MB = 1024 * 1024;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = 60_000;

// Enterprise matches Pro. It was held there by proxy.ts's 520 MB body clone, which no
// longer applies to uploads; raising it is a separate decision.
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

// Railway ends a request that has sent nothing for 5 minutes (#115), and this route sends
// nothing until its output is ready. So an accepted video must be probed, encoded and read
// back within this, counted from when the upload has been received, whatever the plan; the
// minute left over is margin for sending the response. Background jobs would lift it.
export const VIDEO_TIME_BUDGET_MS = 4 * MS_PER_MINUTE;

// The probe reads a 500 MB upload in under 2s. It runs inside VIDEO_TIME_BUDGET_MS.
export const PROBE_DEADLINE_MS = 30_000;

export const MAX_CONCURRENT_VIDEO_ENCODES = 2;

// Per encode, so two encodes take at most four cores whatever the machine has. Against
// ffmpeg's automatic choice this made one encode 1.9x slower and two at once 1.4x slower.
export const FFMPEG_THREADS = 2;

// x264's veryfast preset: with two encodes at once it was 2.0-2.7x as fast as the default
// (medium) at 1080p, its files 7-17% smaller on camera video and within 3% on screen
// recordings and already compressed video, and SSIM 0.001-0.003 lower (#115).
export const X264_PRESET = 'veryfast';

export const COMPRESS_VIDEO_BUSY_MESSAGE = pdfToolBusyMessage('Compress Video');

export const VIDEO_TOO_SLOW_MESSAGE =
  'This video could not be compressed in time. A shorter or lower-resolution video may work.';

export interface VideoEncodeLimits {
  maxDurationSeconds: number;
  timeBudgetMs: number;
}

export function encodeLimitsForPlan(plan: string | null | undefined): VideoEncodeLimits {
  return {
    maxDurationSeconds: resolvePlanLimit(plan, MAX_DURATION_SECONDS),
    timeBudgetMs: VIDEO_TIME_BUDGET_MS,
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
