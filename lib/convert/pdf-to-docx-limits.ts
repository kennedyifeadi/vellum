import { ClientError } from '@/lib/convert/errors';
import type { PdfExtractionOptions } from '@/lib/convert/pdf-extraction';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

const BYTES_PER_MB = 1024 * 1024;

// Text extraction runs in a worker thread bounded by EXTRACTION_LIMITS; the DOCX build
// that follows it runs on the request's own event loop, bounded by the page and line
// caps (a stall of about 0.5s for a guest to 2.5s for Enterprise at the caps).

// The page count needs the parser and the line count needs the extraction itself, so
// size is the one cap that can refuse a PDF before it is read. It is the size of the
// upload, not of what it decodes to: a compressed content stream inflates far past it,
// which is why extraction time is bounded by a deadline rather than by this cap.
const MAX_FILE_SIZE: PlanTierValues<number> = {
  guest: 5 * BYTES_PER_MB,
  Basic: 10 * BYTES_PER_MB,
  Pro: 15 * BYTES_PER_MB,
  Enterprise: 25 * BYTES_PER_MB,
};

// Sized by measurement on ordinary text: the largest page and line counts a tier allows
// convert in about 1s (guest) to 4s (Enterprise). See #81 for the figures.
const MAX_PAGES: PlanTierValues<number> = {
  guest: 100,
  Basic: 200,
  Pro: 300,
  Enterprise: 500,
};

// Every line becomes a paragraph, and paragraph count is what drives the DOCX build.
// A page cap alone does not bound it: a dense page carries far more than the ~80 lines
// these values allow per permitted page.
const MAX_LINES: PlanTierValues<number> = {
  guest: 8_000,
  Basic: 16_000,
  Pro: 24_000,
  Enterprise: 40_000,
};

// What bounds the text extraction whatever the PDF contains, since neither its time nor
// its memory follows the upload size. Measured on the densest PDF each plan's page and
// line caps allow (80 lines of 80 characters on every permitted page), with
// `maxConcurrent` extractions running at once. See #90 for the figures.
export const EXTRACTION_LIMITS = {
  // That PDF extracts in about 1.3s (guest), 3.7s (Basic), 5.3s (Pro) and 8s
  // (Enterprise), so each deadline leaves roughly three times that.
  deadlineMs: {
    guest: 5_000,
    Basic: 10_000,
    Pro: 15_000,
    Enterprise: 25_000,
  } satisfies PlanTierValues<number>,
  // The Enterprise PDF needs between 48 and 64 MB of heap. This bounds the worker's
  // JavaScript heap only: a decoded content stream is held outside it, and is bounded by
  // the deadline alone.
  maxHeapMb: 256,
  // Each extraction keeps a CPU core busy for its whole duration, so this is how many
  // cores PDF to Word may take from the rest of the server.
  maxConcurrent: 2,
};

export const PDF_TOO_COMPLEX_MESSAGE =
  'This PDF is too complex to convert to Word. Splitting it into smaller files may help.';

export const CONVERTER_BUSY_MESSAGE =
  'PDF to Word is busy right now. Please try again in a few seconds.';

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

// Rounded up so that a file just over the cap never reads as being exactly at it.
function formatSizeInMb(bytes: number): string {
  return (Math.ceil((bytes / BYTES_PER_MB) * 10) / 10).toFixed(1);
}

export function assertFileSizeWithinPlan(plan: string | null | undefined, fileSize: number): void {
  const maxFileSize = resolvePlanLimit(plan, MAX_FILE_SIZE);
  if (fileSize > maxFileSize) {
    throw new ClientError(
      `This PDF is ${formatSizeInMb(fileSize)} MB; your plan allows converting PDFs up to ${maxFileSize / BYTES_PER_MB} MB to Word. This limit is specific to PDF to Word and is lower than the general upload limit.`,
    );
  }
}

export function extractionOptionsForPlan(plan: string | null | undefined): PdfExtractionOptions {
  return {
    maxPages: resolvePlanLimit(plan, MAX_PAGES),
    deadlineMs: resolvePlanLimit(plan, EXTRACTION_LIMITS.deadlineMs),
    maxHeapMb: EXTRACTION_LIMITS.maxHeapMb,
    maxConcurrent: EXTRACTION_LIMITS.maxConcurrent,
  };
}

export function assertPageCountWithinPlan(plan: string | null | undefined, pageCount: number): void {
  const maxPages = resolvePlanLimit(plan, MAX_PAGES);
  if (pageCount > maxPages) {
    throw new ClientError(
      `This PDF has ${formatCount(pageCount)} pages; your plan allows converting up to ${formatCount(maxPages)} pages to Word.`,
    );
  }
}

export function assertLineCountWithinPlan(plan: string | null | undefined, lineCount: number): void {
  const maxLines = resolvePlanLimit(plan, MAX_LINES);
  if (lineCount > maxLines) {
    throw new ClientError(
      `This PDF has ${formatCount(lineCount)} lines of text; your plan allows converting up to ${formatCount(maxLines)} lines to Word.`,
    );
  }
}
