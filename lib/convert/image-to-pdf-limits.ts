import { assertImageCountWithinPlan, assertImageTotalSizeWithinPlan } from '@/lib/convert/image-limits';
import { PDF_WORKER_LIMITS, pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';
import type { WorkerLimits } from '@/lib/convert/worker-job';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

// Images are decoded with sharp, outside the worker's JavaScript heap, so this cap, not
// `maxHeapMb`, is what bounds their memory: at the cap one image peaks at 0.14 to 0.43 GB
// above the server's own, and 0.94 GB for an AVIF, whose decoder holds the most.
export { assertPixelCountWithinLimit, MAX_IMAGE_PIXELS } from '@/lib/convert/image-limits';

// What bounds the conversion whatever the images contain. See #98 and #99 for the figures.
export const CONVERSION_LIMITS = {
  // The deadline covers the whole conversion: decoding, re-encoding and the worker. A
  // JPEG kept as it is costs about a second at the pixel cap; any image that is decoded
  // and stored losslessly (PNG, WebP, GIF, TIFF, AVIF, BMP, and JPEGs that need their
  // colours converted) takes 7 to 18s there, which the guest deadline is sized on. No
  // deadline can cover the worst request the other caps allow (250 such images is close
  // to an hour), so each one is in effect a budget of re-encoded pixels per request:
  // roughly two to four images at the cap for a guest, rising to eight to sixteen for
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

export function conversionLimitsForPlan(plan: string | null | undefined): WorkerLimits {
  return {
    deadlineMs: resolvePlanLimit(plan, CONVERSION_LIMITS.deadlineMs),
    maxHeapMb: CONVERSION_LIMITS.maxHeapMb,
    maxConcurrent: CONVERSION_LIMITS.maxConcurrent,
  };
}

export function assertFileCountWithinPlan(plan: string | null | undefined, fileCount: number): void {
  assertImageCountWithinPlan(plan, fileCount, (maxFiles) => `Your current plan allows up to ${maxFiles} files per conversion.`);
}

export function assertTotalSizeWithinPlan(plan: string | null | undefined, fileSizes: number[]): void {
  assertImageTotalSizeWithinPlan(
    plan,
    fileSizes,
    (maxMb) => `Your current plan allows up to ${maxMb}MB of images per conversion.`,
  );
}
