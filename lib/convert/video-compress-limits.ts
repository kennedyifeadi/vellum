import { ClientError } from '@/lib/convert/errors';
import { pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';
import type { UploadBudget } from '@/lib/http/read-upload';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';
import { BYTES_PER_MB, TOOL_LIMITS } from '@/lib/tool-limits';
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = 60_000;

const { maxBytes: MAX_FILE_SIZE, maxVideoMinutes } = TOOL_LIMITS['video-compress'];

// An encode's time follows the video's length, not its size: a 16x16 clip an hour long
// is a few kilobytes. Read by the probe, so it refuses a video before anything is encoded.
// The time budget below now limits most videos to less than these; they still bound
// videos small enough to encode faster than that, such as 480p30 for a guest.
const MAX_DURATION_SECONDS: PlanTierValues<number> = {
  guest: maxVideoMinutes.guest * SECONDS_PER_MINUTE,
  Basic: maxVideoMinutes.Basic * SECONDS_PER_MINUTE,
  Pro: maxVideoMinutes.Pro * SECONDS_PER_MINUTE,
  Enterprise: maxVideoMinutes.Enterprise * SECONDS_PER_MINUTE,
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

export interface EncodeCost {
  /** Seconds to encode a million output pixel-frames while MAX_CONCURRENT_VIDEO_ENCODES run. */
  encodeSecondsPerMegapixelFrame: number;
  /** Seconds to decode and scale a million input pixel-frames, likewise. */
  decodeSecondsPerMegapixelFrame: number;
  /** How many times over the estimate must fit in the time left. */
  safetyFactor: number;
}

// x264's veryfast preset: with two encodes at once it was 2.0-2.7x as fast as the default
// (medium) at 1080p, its files 7-17% smaller on camera video and within 3% on screen
// recordings and already compressed video, and SSIM 0.001-0.003 lower (#115).
export const X264_PRESET = 'veryfast';

// THE NUMBERS TO RE-MEASURE ON THE PRODUCTION CPU (Railway's is unknown). Measured with
// X264_PRESET and FFMPEG_THREADS, two encodes at once, on a 4-core i5-10310U under Windows
// with FFmpeg 6.1.1 and a busy desktop: medians of three runs of 8 s of 16 Mbit/s 1080p30
// test pattern with noise, at CRF 23 (the slowest quality). Encoding cost 0.020-0.026 s
// per output megapixel-frame; decoding and scaling 0.007-0.013 s per input megapixel-frame.
// With the larger figures every median, screen recordings and already compressed video
// included, came within 1.06x of the estimate; single runs reached 1.15x, and once 1.9x
// under desktop load. The factor covers the first two; VIDEO_TOO_SLOW_MESSAGE the rest.
export const ENCODE_COST: EncodeCost = {
  encodeSecondsPerMegapixelFrame: 0.026,
  decodeSecondsPerMegapixelFrame: 0.013,
  safetyFactor: 1.5,
};

export interface EncodeWork {
  /** Frames the encode writes. */
  frames: number;
  /** Pixels in each frame decoded, as stored. */
  inputPixels: number;
  /** Pixels in each frame encoded, after the resolution ceiling. */
  outputPixels: number;
}

export function estimateEncodeSeconds({ frames, inputPixels, outputPixels }: EncodeWork, cost: EncodeCost): number {
  const secondsPerFrame =
    outputPixels * cost.encodeSecondsPerMegapixelFrame + inputPixels * cost.decodeSecondsPerMegapixelFrame;
  return (frames * secondsPerFrame) / 1_000_000;
}

export function encodeFitsTimeBudget(work: EncodeWork, budgetMs: number, cost: EncodeCost): boolean {
  return estimateEncodeSeconds(work, cost) * cost.safetyFactor * 1000 <= budgetMs;
}

/** The length of the longest video at `frameRate` whose encode fits in `budgetMs`. */
export function longestEncodableSeconds(
  { frameRate, inputPixels, outputPixels }: Omit<EncodeWork, 'frames'> & { frameRate: number },
  budgetMs: number,
  cost: EncodeCost,
): number {
  const secondsPerVideoSecond = estimateEncodeSeconds({ frames: frameRate, inputPixels, outputPixels }, cost);
  return budgetMs / 1000 / cost.safetyFactor / secondsPerVideoSecond;
}

function roughLength(seconds: number): string {
  if (seconds >= 2 * SECONDS_PER_MINUTE) return `${Math.floor(seconds / SECONDS_PER_MINUTE)} minutes`;
  if (seconds >= SECONDS_PER_MINUTE) return '1 minute';
  if (seconds >= 20) return `${Math.floor(seconds / 10) * 10} seconds`;
  const wholeSeconds = Math.max(1, Math.floor(seconds));
  return wholeSeconds === 1 ? '1 second' : `${wholeSeconds} seconds`;
}

/**
 * Refuses a video whose encode would not finish in time, naming how long a video like it
 * can be and, when one would let this video through or at least help, a lower resolution.
 */
export function tooMuchWorkMessage(longestSeconds: number, lowerResolution: string | null): string {
  const choice = lowerResolution ? `choose ${lowerResolution} or a shorter clip` : 'choose a shorter clip';
  return (
    'This video would take too long to compress. Videos at this resolution and frame rate can be ' +
    `up to about ${roughLength(longestSeconds)} long; ${choice}.`
  );
}

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
