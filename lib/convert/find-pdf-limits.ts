import { ClientError } from '@/lib/convert/errors';
import type { PdfTextItemsOptions } from '@/lib/convert/find-pdf-extraction';
import type { UploadBudget } from '@/lib/http/read-upload';
import { PDF_WORKER_LIMITS, pdfTooComplexMessage, pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';
import { BYTES_PER_MB, TOOL_LIMITS } from '@/lib/tool-limits';

// Size is the one cap that can refuse a PDF before it is read; the page count needs the
// parser.
const { maxBytes: MAX_FILE_SIZE, maxPages: MAX_PAGES } = TOOL_LIMITS['find-pdf'];

// What bounds the text extraction whatever the PDF contains, since neither its time nor
// its memory follows the upload size or the page count. Measured on the slowest of
// three ordinary documents at each plan's page cap (80 lines of 80 characters a page,
// small print of 160 lines of 130 characters a page, and a 500-cell table on every
// page), with `maxConcurrent` extractions running at once. See #93 for the figures.
export const EXTRACTION_LIMITS = {
  // That document extracts in about 0.7s (guest), 2.2s (Basic), 4s (Pro) and 16s
  // (Enterprise), so each deadline leaves roughly three times that or more.
  deadlineMs: {
    guest: 5_000,
    Basic: 10_000,
    Pro: 15_000,
    Enterprise: 45_000,
  } satisfies PlanTierValues<number>,
  ...PDF_WORKER_LIMITS,
};

export const PDF_TOO_COMPLEX_MESSAGE = pdfTooComplexMessage('search');

export const FIND_PDF_BUSY_MESSAGE = pdfToolBusyMessage('Find in PDF');

export function extractionOptionsForPlan(plan: string | null | undefined): PdfTextItemsOptions {
  return {
    maxPages: resolvePlanLimit(plan, MAX_PAGES),
    deadlineMs: resolvePlanLimit(plan, EXTRACTION_LIMITS.deadlineMs),
    maxHeapMb: EXTRACTION_LIMITS.maxHeapMb,
    maxConcurrent: EXTRACTION_LIMITS.maxConcurrent,
  };
}

export function uploadBudgetForPlan(plan: string | null | undefined): UploadBudget {
  const maxBytes = resolvePlanLimit(plan, MAX_FILE_SIZE);
  return {
    maxBytes,
    tooLarge: () => new ClientError(`Your current plan allows PDFs up to ${maxBytes / BYTES_PER_MB}MB.`),
  };
}

export function assertFileSizeWithinPlan(plan: string | null | undefined, fileSize: number): void {
  const budget = uploadBudgetForPlan(plan);
  if (fileSize > budget.maxBytes) {
    throw budget.tooLarge(fileSize);
  }
}

export function assertPageCountWithinPlan(plan: string | null | undefined, pageCount: number): void {
  const maxPages = resolvePlanLimit(plan, MAX_PAGES);
  if (pageCount > maxPages) {
    throw new ClientError(`Your current plan allows searching up to ${maxPages} pages per document.`);
  }
}
