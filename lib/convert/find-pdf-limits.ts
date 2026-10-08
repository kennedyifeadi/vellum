import { ClientError } from '@/lib/convert/errors';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

const BYTES_PER_MB = 1024 * 1024;

// The same upload caps as split-pdf and compress-pdf. Size is the one cap that can
// refuse a PDF before it is read; the page count needs the parser.
const MAX_FILE_SIZE: PlanTierValues<number> = {
  guest: 25 * BYTES_PER_MB,
  Basic: 50 * BYTES_PER_MB,
  Pro: 100 * BYTES_PER_MB,
  Enterprise: 500 * BYTES_PER_MB,
};

const MAX_PAGES: PlanTierValues<number> = {
  guest: 10,
  Basic: 50,
  Pro: 100,
  Enterprise: 500,
};

export function assertFileSizeWithinPlan(plan: string | null | undefined, fileSize: number): void {
  const maxFileSize = resolvePlanLimit(plan, MAX_FILE_SIZE);
  if (fileSize > maxFileSize) {
    throw new ClientError(`Your current plan allows PDFs up to ${maxFileSize / BYTES_PER_MB}MB.`);
  }
}

export function assertPageCountWithinPlan(plan: string | null | undefined, pageCount: number): void {
  const maxPages = resolvePlanLimit(plan, MAX_PAGES);
  if (pageCount > maxPages) {
    throw new ClientError(`Your current plan allows searching up to ${maxPages} pages per document.`);
  }
}
