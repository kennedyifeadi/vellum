import { ClientError } from '@/lib/convert/errors';
import type { UploadBudget } from '@/lib/http/read-upload';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { BYTES_PER_MB, IMAGE_TOOL_LIMITS } from '@/lib/tool-limits';

const PIXELS_PER_MEGAPIXEL = 1_000_000;

const MAX_FILES = IMAGE_TOOL_LIMITS.maxFiles;

// Applied to the sum of the images in one request. It is the one cap that can refuse a
// request before any of it is read.
const MAX_TOTAL_SIZE = IMAGE_TOOL_LIMITS.maxBytes;

export const MAX_IMAGE_PIXELS = IMAGE_TOOL_LIMITS.maxMegapixelsPerImage * PIXELS_PER_MEGAPIXEL;

// How many requests may re-encode images with sharp at once, across Compress Image and
// JPEG to PNG. Each works on one image at a time, so this bounds the images decoded at
// once, and memory with it: at the pixel cap one image peaks at up to 0.94 GB above the
// server's own (a WebP photo compressed at low; 0.4 GB for JPEG to PNG), and two at once
// at 1.9 GB. sharp's cache and thread settings made no difference to these peaks.
export const MAX_CONCURRENT_IMAGE_JOBS = 2;

// Rounded up so that an image just over the cap never reads as being exactly at it.
function formatMegapixels(pixels: number): string {
  return (Math.ceil((pixels / PIXELS_PER_MEGAPIXEL) * 10) / 10).toFixed(1);
}

export function assertImageCountWithinPlan(
  plan: string | null | undefined,
  fileCount: number,
  capMessage: (maxFiles: number) => string,
): void {
  const maxFiles = resolvePlanLimit(plan, MAX_FILES);
  if (fileCount > maxFiles) {
    throw new ClientError(capMessage(maxFiles));
  }
}

export function imageUploadBudget(
  plan: string | null | undefined,
  capMessage: (maxMb: number) => string,
): UploadBudget {
  const maxBytes = resolvePlanLimit(plan, MAX_TOTAL_SIZE);
  return { maxBytes, tooLarge: () => new ClientError(capMessage(maxBytes / BYTES_PER_MB)) };
}

export function assertImageTotalSizeWithinPlan(
  plan: string | null | undefined,
  fileSizes: number[],
  capMessage: (maxMb: number) => string,
): void {
  const budget = imageUploadBudget(plan, capMessage);
  const totalSize = fileSizes.reduce((total, fileSize) => total + fileSize, 0);
  if (totalSize > budget.maxBytes) {
    throw budget.tooLarge(totalSize);
  }
}

export function assertPixelCountWithinLimit(imageNumber: number, width: number, height: number): void {
  const pixels = width * height;
  if (pixels > MAX_IMAGE_PIXELS) {
    throw new ClientError(
      `Image ${imageNumber} is ${formatMegapixels(pixels)} megapixels. Each image can be at most ${MAX_IMAGE_PIXELS / PIXELS_PER_MEGAPIXEL} megapixels.`,
    );
  }
}
