import path from 'path';
import { ClientError } from '@/lib/convert/errors';
import { runPdfWorker, type PdfWorkerLimits } from '@/lib/convert/pdf-worker';
import { runWorkerJob, type WorkerLimits } from '@/lib/convert/worker-job';
import { runImageJob } from '@/lib/image/image-jobs';

// Stand-ins for each tool's heavy work that run in that tool's real slot pool and hold
// their slot until the test ends them, so a test can keep a job running for as long as
// it needs without sleeping.

export type HeldOutcome = 'succeed' | 'client-error' | 'server-error';

export interface HeldJob {
  tool: string;
  finish(outcome?: HeldOutcome): void;
}

interface StartedJob extends HeldJob {
  workerId?: string;
}

export const HELD_CLIENT_ERROR_MESSAGE = 'Held job refused its input';
export const CANCELLED_MESSAGE = 'Held job was cancelled';

const HELD_WORKER_PATH = path.join(process.cwd(), 'tests', 'helpers', 'held-worker.mjs');
// The name held-worker.mjs listens on.
const CHANNEL_NAME = 'vellum-held-worker-jobs';

const started: StartedJob[] = [];
const awaitingReady = new Map<string, () => void>();
let channel: BroadcastChannel | undefined;
let workerJobCount = 0;
let workerDeadlineMs: number | undefined;

function heldChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => awaitingReady.get((event as MessageEvent).data.ready)?.();
    (channel as unknown as { unref(): void }).unref();
  }
  return channel;
}

/** Forgets the jobs a test started; call between tests. */
export function resetHeldJobs(): void {
  started.length = 0;
  workerDeadlineMs = undefined;
}

/** Gives the held worker jobs started from now on this deadline instead of the route's. */
export function setHeldWorkerDeadline(deadlineMs: number | undefined): void {
  workerDeadlineMs = deadlineMs;
}

/**
 * The next job of `tool` to start, once it holds its slot. Rejects if `stopWaiting` says
 * so first, as when the request has already been answered without starting one.
 */
export async function nextHeldJob(tool: string, stopWaiting = () => false): Promise<HeldJob> {
  for (;;) {
    const index = started.findIndex((job) => job.tool === tool);
    if (index >= 0) {
      return started.splice(index, 1)[0];
    }
    if (stopWaiting()) {
      throw new Error(`No ${tool} job started`);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** In-process work, such as a sharp or ffmpeg job, that ends when the test says or `signal` aborts. */
export function holdInProcess<Result>(tool: string, result: Result, signal?: AbortSignal): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new ClientError(CANCELLED_MESSAGE)));
    started.push({
      tool,
      finish(outcome = 'succeed') {
        if (outcome === 'succeed') resolve(result);
        else reject(outcome === 'client-error' ? new ClientError(HELD_CLIENT_ERROR_MESSAGE) : new Error('Held job failed'));
      },
    });
  });
}

function heldWorker(tool: string, result: unknown, limits: WorkerLimits) {
  const id = `${tool}#${++workerJobCount}`;
  const broadcast = heldChannel();
  awaitingReady.set(id, () => {
    awaitingReady.delete(id);
    started.push({ tool, workerId: id, finish: (outcome = 'succeed') => broadcast.postMessage({ id, outcome, result }) });
  });
  return {
    id,
    workerPath: HELD_WORKER_PATH,
    data: new TextEncoder().encode(id),
    limits: { ...limits, deadlineMs: workerDeadlineMs ?? limits.deadlineMs },
  };
}

// A worker killed by its deadline may have announced itself first, or may yet; either
// way it must not be handed to a test as a job still running.
function forgetWorker(id: string): void {
  awaitingReady.delete(id);
  const index = started.findIndex((job) => job.workerId === id);
  if (index >= 0) started.splice(index, 1);
}

function heldResult(message: unknown): unknown {
  const held = message as { kind?: unknown; result?: unknown } | null;
  return held?.kind === 'held-result' ? held.result : undefined;
}

/** A PDF extraction in the PDF worker pool, as PDF to Word and Find in PDF run one. */
export function runHeldPdfExtraction<Result>(tool: string, result: Result, options: PdfWorkerLimits & { maxPages: number }): Promise<Result> {
  const { maxPages, ...limits } = options;
  const { id, workerPath, data, limits: heldLimits } = heldWorker(tool, result, limits);
  return runPdfWorker({
    workerPath,
    data,
    maxPages,
    limits: heldLimits,
    readResult: (message) => heldResult(message) as Result,
  }).finally(() => forgetWorker(id));
}

/** Image to PDF's two steps: an image job, then a PDF worker job; each is held in turn. */
export async function runHeldImageToPdf(limits: WorkerLimits): Promise<Buffer> {
  await runImageJob(() => holdInProcess('image-to-pdf:images', undefined));
  const { id, workerPath, data, limits: heldLimits } = heldWorker('image-to-pdf:pdf', '%PDF-held', limits);
  return runWorkerJob({
    name: 'Held Image to PDF',
    workerPath,
    workerData: { data },
    limits: heldLimits,
    readMessage(message) {
      const result = heldResult(message);
      if (typeof result !== 'string') throw new ClientError(HELD_CLIENT_ERROR_MESSAGE);
      return Buffer.from(result);
    },
  }).finally(() => forgetWorker(id));
}
