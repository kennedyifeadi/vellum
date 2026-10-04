import { ClientError } from '@/lib/convert/errors';
import { PlanTierValues, resolvePlanLimit } from '@/lib/plan-limits';

// The conversion runs in-process and blocks the event loop for its whole duration, so
// both caps are sized by measurement: the largest input a tier allows converts in about
// 1s (guest) to 4s (Enterprise). See #81 for the figures.
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
