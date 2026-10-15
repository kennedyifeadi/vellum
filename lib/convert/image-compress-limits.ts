import { assertImageCountWithinPlan, assertImageTotalSizeWithinPlan } from '@/lib/convert/image-limits';
import { pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';

export const COMPRESS_IMAGE_BUSY_MESSAGE = pdfToolBusyMessage('Compress Image');

export function assertFileCountWithinPlan(plan: string | null | undefined, fileCount: number): void {
  assertImageCountWithinPlan(plan, fileCount, (maxFiles) => `Your current plan allows up to ${maxFiles} images per compression.`);
}

export function assertTotalSizeWithinPlan(plan: string | null | undefined, fileSizes: number[]): void {
  assertImageTotalSizeWithinPlan(
    plan,
    fileSizes,
    (maxMb) => `Your current plan allows up to ${maxMb}MB of images per compression.`,
  );
}
