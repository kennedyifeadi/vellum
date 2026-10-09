import { ClientError } from '@/lib/convert/errors';
import { PDF_WORKER_LIMITS, pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';
import type { WorkerLimits } from '@/lib/convert/worker-job';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

const BYTES_PER_MB = 1024 * 1024;
const PIXELS_PER_MEGAPIXEL = 1_000_000;

const MAX_FILES: PlanTierValues<number> = {
  guest: 3,
  Basic: 30,
  Pro: 50,
  Enterprise: 250,
};

// The same tiers as the PDF tools, applied to the sum of the images in one request. It
// is the one cap that can refuse a request before any of it is read.
const MAX_TOTAL_SIZE: PlanTierValues<number> = {
  guest: 25 * BYTES_PER_MB,
  Basic: 50 * BYTES_PER_MB,
  Pro: 100 * BYTES_PER_MB,
  Enterprise: 500 * BYTES_PER_MB,
};

// Read from the image's header, so it is checked before any pixel is decoded. A PNG's
// cost follows its pixels, not its bytes: a flat-colour 100-megapixel PNG is under
// 300 KB and took 1.15 GB to convert, a 268-megapixel one 2.9 GB. At this cap the
// conversion of one PNG peaks at about 520 MB. A decoded image is held outside the
// worker's JavaScript heap, so this cap, not `maxHeapMb`, is what bounds its memory.
export const MAX_IMAGE_PIXELS = 50 * PIXELS_PER_MEGAPIXEL;

// What bounds the conversion whatever the images contain. See #98 for the figures.
export const CONVERSION_LIMITS = {
  // pdf-lib converts a PNG at 0.22 to 0.35s per megapixel with `maxConcurrent` jobs
  // running (0.8 for one that does not compress, which the size cap keeps small); a
  // JPEG is stored as it is and costs milliseconds. One PNG at the pixel cap takes 11
  // to 13s, and up to 25s on a busy machine, which the guest deadline is sized on.
  // No deadline can cover the worst request the other caps allow (250 PNGs of 50
  // megapixels is close to an hour), so each one is in effect a budget of PNG pixels
  // per request: roughly 85 to 135 megapixels for a guest, rising to 340 to 540 for
  // Enterprise. It is also how long one request can hold a slot.
  deadlineMs: {
    guest: 30_000,
    Basic: 60_000,
    Pro: 90_000,
    Enterprise: 120_000,
  } satisfies PlanTierValues<number>,
  ...PDF_WORKER_LIMITS,
};

export const IMAGES_TOO_COMPLEX_MESSAGE =
  'These images are too complex to convert to PDF. Converting fewer or smaller images at a time may help.';

export const IMAGE_TO_PDF_BUSY_MESSAGE = pdfToolBusyMessage('Image to PDF');

// Rounded up so that an image just over the cap never reads as being exactly at it.
function formatMegapixels(pixels: number): string {
  return (Math.ceil((pixels / PIXELS_PER_MEGAPIXEL) * 10) / 10).toFixed(1);
}

export function conversionLimitsForPlan(plan: string | null | undefined): WorkerLimits {
  return {
    deadlineMs: resolvePlanLimit(plan, CONVERSION_LIMITS.deadlineMs),
    maxHeapMb: CONVERSION_LIMITS.maxHeapMb,
    maxConcurrent: CONVERSION_LIMITS.maxConcurrent,
  };
}

export function assertFileCountWithinPlan(plan: string | null | undefined, fileCount: number): void {
  const maxFiles = resolvePlanLimit(plan, MAX_FILES);
  if (fileCount > maxFiles) {
    throw new ClientError(`Your current plan allows up to ${maxFiles} files per conversion.`);
  }
}

export function assertTotalSizeWithinPlan(plan: string | null | undefined, fileSizes: number[]): void {
  const maxTotalSize = resolvePlanLimit(plan, MAX_TOTAL_SIZE);
  const totalSize = fileSizes.reduce((total, fileSize) => total + fileSize, 0);
  if (totalSize > maxTotalSize) {
    throw new ClientError(
      `Your current plan allows up to ${maxTotalSize / BYTES_PER_MB}MB of images per conversion.`,
    );
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
