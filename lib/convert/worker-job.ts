// Read at runtime rather than imported: when Turbopack sees `new Worker(...)` on the
// class imported from 'worker_threads' it traces the worker file as part of the server
// bundle, and the build then fails on that file's own imports of external packages
// ("NftJsonAsset: cannot handle filepath", Next.js 16.1.6).
const { Worker } = process.getBuiltinModule('worker_threads');

const OUT_OF_MEMORY_CODE = 'ERR_WORKER_OUT_OF_MEMORY';

export interface WorkerLimits {
  deadlineMs: number;
  maxHeapMb: number;
  maxConcurrent: number;
}

export interface WorkerJob<Result> {
  /** What the job does, for the message of an error. */
  name: string;
  /**
   * The worker's entry file, resolved from the working directory because it is a source
   * file, not part of the server bundle: `next dev`, `next start` and Jest all run from
   * the project root, and next.config.ts traces the file into a deployed output at the
   * same relative path.
   */
  workerPath: string;
  workerData: unknown;
  /** Buffers in `workerData` to hand over rather than copy; the caller loses them. */
  transferList?: ArrayBuffer[];
  limits: WorkerLimits;
  /** Returns the result the worker's message carries, or throws. */
  readMessage(message: unknown): Result;
}

export type WorkerJobFailureReason = 'deadline' | 'memory' | 'busy';

export class WorkerJobError extends Error {
  readonly reason: WorkerJobFailureReason;

  constructor(reason: WorkerJobFailureReason, message: string) {
    super(message);
    this.name = 'WorkerJobError';
    this.reason = reason;
  }
}

// One count for every tool that runs a job, so the limit is on the cores these jobs
// take in total rather than on each tool separately.
let activeWorkers = 0;

function runWorker<Result>(job: WorkerJob<Result>): Promise<Result> {
  const worker = new Worker(job.workerPath, {
    workerData: job.workerData,
    transferList: job.transferList,
    resourceLimits: { maxOldGenerationSizeMb: job.limits.maxHeapMb },
    // A native addon loaded in a worker thread can take the whole process down when the
    // thread exits, and the canvas addon pdf.js loads does. See pdf-worker-runtime.mjs.
    execArgv: ['--no-addons'],
  });
  let deadline: NodeJS.Timeout;

  const outcome = new Promise<Result>((resolve, reject) => {
    deadline = setTimeout(
      () => reject(new WorkerJobError('deadline', `${job.name} exceeded its deadline`)),
      job.limits.deadlineMs,
    );

    worker.once('message', (message) => {
      try {
        resolve(job.readMessage(message));
      } catch (error) {
        reject(error);
      }
    });
    worker.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === OUT_OF_MEMORY_CODE
          ? new WorkerJobError('memory', `${job.name} exceeded its memory limit`)
          : error,
      );
    });
    worker.once('exit', (exitCode) => {
      reject(new Error(`${job.name} worker exited with code ${exitCode} before returning a result`));
    });
  });

  return outcome.finally(() => {
    clearTimeout(deadline);
    return worker.terminate();
  });
}

/**
 * Runs one job in a worker thread, so that work which is slow on some input cannot
 * block the event loop serving other requests. The worker is terminated when the
 * deadline or the heap limit is hit, and has exited by the time the returned promise
 * settles. The heap limit covers the worker's JavaScript heap, not buffers allocated
 * outside it; those are bounded only by the deadline and by the caller's own caps.
 *
 * Rejects with a `WorkerJobError` naming the cause. Any other rejection means the
 * worker itself failed; the caller must not fall back to doing the work in-process.
 */
export async function runWorkerJob<Result>(job: WorkerJob<Result>): Promise<Result> {
  if (activeWorkers >= job.limits.maxConcurrent) {
    throw new WorkerJobError('busy', `Too many worker jobs are already running to start ${job.name}`);
  }

  activeWorkers += 1;
  try {
    return await runWorker(job);
  } finally {
    activeWorkers -= 1;
  }
}
