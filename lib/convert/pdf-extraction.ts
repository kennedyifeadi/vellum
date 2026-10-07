import path from 'path';
import type { ExtractedPage } from '@/lib/convert/pdf-text';

// Read at runtime rather than imported: when Turbopack sees `new Worker(...)` on the
// class imported from 'worker_threads' it traces the worker file as part of the server
// bundle, and the build then fails on that file's own imports of external packages
// ("NftJsonAsset: cannot handle filepath", Next.js 16.1.6).
const { Worker } = process.getBuiltinModule('worker_threads');

// Resolved from the working directory because the worker is a source file, not part of
// the server bundle: `next dev`, `next start` and Jest all run from the project root,
// and next.config.ts traces the file into a deployed output at the same relative path.
const WORKER_PATH = path.join(process.cwd(), 'lib', 'convert', 'pdf-extraction-worker.mjs');

const OUT_OF_MEMORY_CODE = 'ERR_WORKER_OUT_OF_MEMORY';

export interface PdfExtractionOptions {
  maxPages: number;
  deadlineMs: number;
  maxHeapMb: number;
  maxConcurrent: number;
}

export type PdfExtractionFailure =
  | { reason: 'page-limit'; pageCount: number }
  | { reason: 'deadline' }
  | { reason: 'memory' }
  | { reason: 'busy' }
  | { reason: 'parser' };

type WorkerMessage =
  | { kind: 'pages'; pages: ExtractedPage[] }
  | { kind: 'page-limit'; pageCount: number }
  | { kind: 'parser-error'; name: string; message: string };

export class PdfExtractionError extends Error {
  readonly failure: PdfExtractionFailure;

  constructor(failure: PdfExtractionFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfExtractionError';
    this.failure = failure;
  }
}

let activeExtractions = 0;

function isExtractedPage(page: unknown): page is ExtractedPage {
  const candidate = page as ExtractedPage | null;
  return typeof candidate?.num === 'number' && typeof candidate.text === 'string';
}

function toParserError(name: string, message: string): Error {
  const parserError = new Error(message);
  parserError.name = name;
  return parserError;
}

function readWorkerMessage(message: unknown): ExtractedPage[] {
  const result = message as WorkerMessage | null;

  if (result?.kind === 'pages' && Array.isArray(result.pages) && result.pages.every(isExtractedPage)) {
    return result.pages;
  }
  if (result?.kind === 'page-limit' && typeof result.pageCount === 'number') {
    throw new PdfExtractionError(
      { reason: 'page-limit', pageCount: result.pageCount },
      `PDF has ${result.pageCount} pages, over the page limit`,
    );
  }
  if (result?.kind === 'parser-error') {
    throw new PdfExtractionError({ reason: 'parser' }, 'PDF could not be parsed', {
      cause: toParserError(String(result.name), String(result.message)),
    });
  }
  throw new Error('PDF extraction worker returned an unexpected result');
}

function runWorker(data: Uint8Array, options: PdfExtractionOptions): Promise<ExtractedPage[]> {
  const worker = new Worker(WORKER_PATH, {
    workerData: { data, maxPages: options.maxPages },
    transferList: [data.buffer as ArrayBuffer],
    resourceLimits: { maxOldGenerationSizeMb: options.maxHeapMb },
    // A native addon loaded in a worker thread can take the whole process down when the
    // thread exits, and the canvas addon pdf.js loads does. See the worker file.
    execArgv: ['--no-addons'],
  });
  let deadline: NodeJS.Timeout;

  const outcome = new Promise<ExtractedPage[]>((resolve, reject) => {
    deadline = setTimeout(
      () => reject(new PdfExtractionError({ reason: 'deadline' }, 'PDF extraction exceeded its deadline')),
      options.deadlineMs,
    );

    worker.once('message', (message) => {
      try {
        resolve(readWorkerMessage(message));
      } catch (error) {
        reject(error);
      }
    });
    worker.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === OUT_OF_MEMORY_CODE
          ? new PdfExtractionError({ reason: 'memory' }, 'PDF extraction exceeded its memory limit')
          : error,
      );
    });
    worker.once('exit', (exitCode) => {
      reject(new Error(`PDF extraction worker exited with code ${exitCode} before returning a result`));
    });
  });

  return outcome.finally(() => {
    clearTimeout(deadline);
    return worker.terminate();
  });
}

/**
 * Extracts the text of each page in a worker thread, so that a PDF which is slow to
 * interpret cannot block the event loop serving other requests. The worker is terminated
 * when the deadline or the heap limit is hit, and has exited by the time the returned
 * promise settles. The heap limit covers the worker's JavaScript heap, not the buffers
 * pdf.js decodes streams into; those are bounded only by the deadline.
 *
 * `data` is transferred to the worker and is unusable by the caller afterwards.
 *
 * Rejects with a `PdfExtractionError` naming the cause. Any other rejection means the
 * worker itself failed; the caller must not fall back to extracting in-process.
 */
export async function extractPdfPages(
  data: Uint8Array,
  options: PdfExtractionOptions,
): Promise<ExtractedPage[]> {
  if (activeExtractions >= options.maxConcurrent) {
    throw new PdfExtractionError({ reason: 'busy' }, 'Too many PDF extractions are already running');
  }

  activeExtractions += 1;
  try {
    return await runWorker(data, options);
  } finally {
    activeExtractions -= 1;
  }
}
