// Read at runtime rather than imported: when Turbopack sees `new Worker(...)` on the
// class imported from 'worker_threads' it traces the worker file as part of the server
// bundle, and the build then fails on that file's own imports of external packages
// ("NftJsonAsset: cannot handle filepath", Next.js 16.1.6).
const { Worker } = process.getBuiltinModule('worker_threads');

const OUT_OF_MEMORY_CODE = 'ERR_WORKER_OUT_OF_MEMORY';

export interface PdfWorkerLimits {
  deadlineMs: number;
  maxHeapMb: number;
  maxConcurrent: number;
}

export interface PdfWorkerJob<Result> {
  /**
   * The worker's entry file, resolved from the working directory because it is a source
   * file, not part of the server bundle: `next dev`, `next start` and Jest all run from
   * the project root, and next.config.ts traces the file into a deployed output at the
   * same relative path.
   */
  workerPath: string;
  data: Uint8Array;
  maxPages: number;
  limits: PdfWorkerLimits;
  /** Returns the worker's result, or `undefined` when the message is not one. */
  readResult(message: unknown): Result | undefined;
}

export type PdfExtractionFailure =
  | { reason: 'page-limit'; pageCount: number }
  | { reason: 'deadline' }
  | { reason: 'memory' }
  | { reason: 'busy' }
  | { reason: 'parser' };

type WorkerRefusal =
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

// One count for every tool that extracts, so the limit is on the cores PDF extraction
// takes in total rather than on each tool separately.
let activeWorkers = 0;

export function isBusy(error: unknown): boolean {
  return error instanceof PdfExtractionError && error.failure.reason === 'busy';
}

function toParserError(name: string, message: string): Error {
  const parserError = new Error(message);
  parserError.name = name;
  return parserError;
}

function readWorkerMessage<Result>(message: unknown, job: PdfWorkerJob<Result>): Result {
  const refusal = message as WorkerRefusal | null;

  if (refusal?.kind === 'page-limit' && typeof refusal.pageCount === 'number') {
    throw new PdfExtractionError(
      { reason: 'page-limit', pageCount: refusal.pageCount },
      `PDF has ${refusal.pageCount} pages, over the page limit`,
    );
  }
  if (refusal?.kind === 'parser-error') {
    throw new PdfExtractionError({ reason: 'parser' }, 'PDF could not be parsed', {
      cause: toParserError(String(refusal.name), String(refusal.message)),
    });
  }

  const result = job.readResult(message);
  if (result === undefined) {
    throw new Error('PDF extraction worker returned an unexpected result');
  }
  return result;
}

function runWorker<Result>(job: PdfWorkerJob<Result>): Promise<Result> {
  const worker = new Worker(job.workerPath, {
    workerData: { data: job.data, maxPages: job.maxPages },
    transferList: [job.data.buffer as ArrayBuffer],
    resourceLimits: { maxOldGenerationSizeMb: job.limits.maxHeapMb },
    // A native addon loaded in a worker thread can take the whole process down when the
    // thread exits, and the canvas addon pdf.js loads does. See pdf-worker-runtime.mjs.
    execArgv: ['--no-addons'],
  });
  let deadline: NodeJS.Timeout;

  const outcome = new Promise<Result>((resolve, reject) => {
    deadline = setTimeout(
      () => reject(new PdfExtractionError({ reason: 'deadline' }, 'PDF extraction exceeded its deadline')),
      job.limits.deadlineMs,
    );

    worker.once('message', (message) => {
      try {
        resolve(readWorkerMessage(message, job));
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
 * Runs one PDF extraction in a worker thread, so that a PDF which is slow to interpret
 * cannot block the event loop serving other requests. The worker is terminated when the
 * deadline or the heap limit is hit, and has exited by the time the returned promise
 * settles. The heap limit covers the worker's JavaScript heap, not the buffers pdf.js
 * decodes streams into; those are bounded only by the deadline.
 *
 * `job.data` is transferred to the worker and is unusable by the caller afterwards.
 *
 * Rejects with a `PdfExtractionError` naming the cause. Any other rejection means the
 * worker itself failed; the caller must not fall back to extracting in-process.
 */
export async function runPdfWorker<Result>(job: PdfWorkerJob<Result>): Promise<Result> {
  if (activeWorkers >= job.limits.maxConcurrent) {
    throw new PdfExtractionError({ reason: 'busy' }, 'Too many PDF extractions are already running');
  }

  activeWorkers += 1;
  try {
    return await runWorker(job);
  } finally {
    activeWorkers -= 1;
  }
}
