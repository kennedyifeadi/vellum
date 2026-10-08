import { ClientError } from '@/lib/convert/errors';
import type { PdfTextItemsOptions } from '@/lib/convert/find-pdf-extraction';
import { PDF_WORKER_LIMITS, pdfTooComplexMessage, pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';
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
