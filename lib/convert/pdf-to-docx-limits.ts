import { ClientError } from '@/lib/convert/errors';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

const BYTES_PER_MB = 1024 * 1024;

// The conversion runs in-process and blocks the event loop for its whole duration. The
// three caps together bound that stall: size bounds the text extraction, pages and
// lines bound the DOCX build that follows it.

// Extraction cost follows the bytes pdf.js has to interpret. The page count needs the
// parser and the line count needs the extraction itself, so size is the one cap that can
// refuse a PDF before any parsing. Measured worst case for a one-page PDF at the cap:
// about 4s (guest), 10s (Basic), 12s (Pro) and 21s (Enterprise). See #86 for the figures.
// This is the size of the upload, not of what it decodes to: a compressed content stream
// can inflate far past the cap, which only isolating the extraction can bound (#83).
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
