import {
  runWorkerJob,
  WorkerJobError,
  type WorkerJobFailureReason,
  type WorkerLimits,
} from '@/lib/convert/worker-job';

export type PdfWorkerLimits = WorkerLimits;

export interface PdfWorkerJob<Result> {
  /** The worker's entry file; see `WorkerJob.workerPath`. */
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

const JOB_FAILURE_MESSAGES: Record<WorkerJobFailureReason, string> = {
  deadline: 'PDF extraction exceeded its deadline',
  memory: 'PDF extraction exceeded its memory limit',
  busy: 'Too many PDF extractions are already running',
};

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

/**
 * Runs one PDF extraction in a worker thread; see `runWorkerJob` for how it is bounded
 * and terminated. The heap limit does not cover the buffers pdf.js decodes streams
 * into; those are bounded only by the deadline.
 *
 * `job.data` is transferred to the worker and is unusable by the caller afterwards.
 *
 * Rejects with a `PdfExtractionError` naming the cause. Any other rejection means the
 * worker itself failed; the caller must not fall back to extracting in-process.
 */
export async function runPdfWorker<Result>(job: PdfWorkerJob<Result>): Promise<Result> {
  try {
    return await runWorkerJob({
      name: 'PDF extraction',
      workerPath: job.workerPath,
      workerData: { data: job.data, maxPages: job.maxPages },
      transferList: [job.data.buffer as ArrayBuffer],
      limits: job.limits,
      readMessage: (message) => readWorkerMessage(message, job),
    });
  } catch (error) {
    if (error instanceof WorkerJobError) {
      throw new PdfExtractionError({ reason: error.reason }, JOB_FAILURE_MESSAGES[error.reason]);
    }
    throw error;
  }
}
