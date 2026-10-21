import { assertImageCountWithinPlan, assertImageTotalSizeWithinPlan, imageUploadBudget } from '@/lib/convert/image-limits';
import type { UploadBudget } from '@/lib/http/read-upload';
import { pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';

const BYTES_PER_MB = 1024 * 1024;

// A true-colour PNG is several times the size of the JPEG it came from: a 50-megapixel
// photo becomes about 135 MB. Larger outputs are still returned, and recorded in the
// history without a copy to download again.
export const MAX_STORED_OUTPUT_SIZE = 25 * BYTES_PER_MB;

export const JPEG_TO_PNG_BUSY_MESSAGE = pdfToolBusyMessage('JPEG to PNG');

export function assertFileCountWithinPlan(plan: string | null | undefined, fileCount: number): void {
  assertImageCountWithinPlan(plan, fileCount, (maxFiles) => `Your current plan allows up to ${maxFiles} images per conversion.`);
}

function totalSizeCapMessage(maxMb: number): string {
  return `Your current plan allows up to ${maxMb}MB of images per conversion.`;
}

export function uploadBudgetForPlan(plan: string | null | undefined): UploadBudget {
  return imageUploadBudget(plan, totalSizeCapMessage);
}

export function assertTotalSizeWithinPlan(plan: string | null | undefined, fileSizes: number[]): void {
  assertImageTotalSizeWithinPlan(plan, fileSizes, totalSizeCapMessage);
}
