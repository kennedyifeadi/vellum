import path from 'path';
import type { ExtractedPage } from '@/lib/convert/pdf-text';
import { runPdfWorker, type PdfWorkerLimits } from '@/lib/convert/pdf-worker';

export { PdfExtractionError, type PdfExtractionFailure } from '@/lib/convert/pdf-worker';

const WORKER_PATH = path.join(process.cwd(), 'lib', 'convert', 'pdf-extraction-worker.mjs');

export interface PdfExtractionOptions extends PdfWorkerLimits {
  maxPages: number;
}

function isExtractedPage(page: unknown): page is ExtractedPage {
  const candidate = page as ExtractedPage | null;
  return typeof candidate?.num === 'number' && typeof candidate.text === 'string';
}

function readPages(message: unknown): ExtractedPage[] | undefined {
  const result = message as { kind?: unknown; pages?: unknown } | null;
  if (result?.kind === 'pages' && Array.isArray(result.pages) && result.pages.every(isExtractedPage)) {
    return result.pages;
  }
  return undefined;
}

/**
 * Extracts the text of each page in a worker thread; see `runPdfWorker` for how the
 * extraction is bounded and how it fails.
 *
 * `data` is transferred to the worker and is unusable by the caller afterwards.
 */
export async function extractPdfPages(
  data: Uint8Array,
  options: PdfExtractionOptions,
): Promise<ExtractedPage[]> {
  const { maxPages, ...limits } = options;
  return runPdfWorker({ workerPath: WORKER_PATH, data, maxPages, limits, readResult: readPages });
}
