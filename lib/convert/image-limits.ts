import { ClientError } from '@/lib/convert/errors';
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

// Read from the image's header, so it is checked before any pixel is decoded. An
// image's cost follows its pixels, not its bytes: a flat-colour 268-megapixel PNG is
// under 800 KB and took 1.5 GB to re-encode.
export const MAX_IMAGE_PIXELS = 50 * PIXELS_PER_MEGAPIXEL;

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

export function assertImageTotalSizeWithinPlan(
  plan: string | null | undefined,
  fileSizes: number[],
  capMessage: (maxMb: number) => string,
): void {
  const maxTotalSize = resolvePlanLimit(plan, MAX_TOTAL_SIZE);
  const totalSize = fileSizes.reduce((total, fileSize) => total + fileSize, 0);
  if (totalSize > maxTotalSize) {
    throw new ClientError(capMessage(maxTotalSize / BYTES_PER_MB));
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
