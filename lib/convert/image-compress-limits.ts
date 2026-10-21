import { assertImageCountWithinPlan, assertImageTotalSizeWithinPlan, imageUploadBudget } from '@/lib/convert/image-limits';
import type { UploadBudget } from '@/lib/http/read-upload';
import { pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';

export const COMPRESS_IMAGE_BUSY_MESSAGE = pdfToolBusyMessage('Compress Image');

export function assertFileCountWithinPlan(plan: string | null | undefined, fileCount: number): void {
  assertImageCountWithinPlan(plan, fileCount, (maxFiles) => `Your current plan allows up to ${maxFiles} images per compression.`);
}

function totalSizeCapMessage(maxMb: number): string {
  return `Your current plan allows up to ${maxMb}MB of images per compression.`;
}

export function uploadBudgetForPlan(plan: string | null | undefined): UploadBudget {
  return imageUploadBudget(plan, totalSizeCapMessage);
}

export function assertTotalSizeWithinPlan(plan: string | null | undefined, fileSizes: number[]): void {
  assertImageTotalSizeWithinPlan(plan, fileSizes, totalSizeCapMessage);
}
