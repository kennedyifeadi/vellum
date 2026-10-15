import { assertImageCountWithinPlan, assertImageTotalSizeWithinPlan } from '@/lib/convert/image-limits';
import { PDF_WORKER_LIMITS, pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';
import type { WorkerLimits } from '@/lib/convert/worker-job';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

// At the pixel cap the conversion of one PNG peaks at about 520 MB. A decoded image is
// held outside the worker's JavaScript heap, so this cap, not `maxHeapMb`, is what
// bounds its memory.
export { assertPixelCountWithinLimit, MAX_IMAGE_PIXELS } from '@/lib/convert/image-limits';

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
