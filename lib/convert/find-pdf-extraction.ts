import path from 'path';
import { runPdfWorker, type PdfWorkerLimits } from '@/lib/convert/pdf-worker';
import type { TextItemLike } from '@/lib/pdf/findPdfStream';

const WORKER_PATH = path.join(process.cwd(), 'lib', 'convert', 'find-pdf-extraction-worker.mjs');

export interface PdfTextItemsOptions extends PdfWorkerLimits {
  maxPages: number;
}

/** What the search and the highlighting read from a pdf.js text item. */
export type PdfTextItem = Required<TextItemLike>;

function isTextItem(item: unknown): item is PdfTextItem {
  const candidate = item as PdfTextItem | null;
  return (
    typeof candidate?.str === 'string' &&
    typeof candidate.hasEOL === 'boolean' &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    Array.isArray(candidate.transform) &&
    candidate.transform.every((value) => typeof value === 'number')
  );
}

function isPageOfTextItems(page: unknown): page is PdfTextItem[] {
  return Array.isArray(page) && page.every(isTextItem);
}

function readPages(message: unknown): PdfTextItem[][] | undefined {
  const result = message as { kind?: unknown; pages?: unknown } | null;
  if (result?.kind === 'text-items' && Array.isArray(result.pages) && result.pages.every(isPageOfTextItems)) {
    return result.pages;
  }
  return undefined;
}

/**
 * Extracts the positioned text items of each page, in page order, in a worker thread;
 * see `runPdfWorker` for how the extraction is bounded and how it fails.
 *
 * `data` is transferred to the worker and is unusable by the caller afterwards.
 */
export async function extractPdfTextItems(
  data: Uint8Array,
  options: PdfTextItemsOptions,
): Promise<PdfTextItem[][]> {
  const { maxPages, ...limits } = options;
  return runPdfWorker({ workerPath: WORKER_PATH, data, maxPages, limits, readResult: readPages });
}
