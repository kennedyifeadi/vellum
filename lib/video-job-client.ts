import { RetryCancelledError, sleep } from '@/lib/busy-retry';
import { fileNameFromDisposition } from '@/lib/http/content-disposition';

// How the upload screen follows a Compress Video job from upload to download. The upload
// answers 202 with the job's id (and a token for a guest); the status route says where the
// job is until it ends.

export const VIDEO_JOB_POLL_INTERVAL_MS = 2_000;

export interface VideoJobStatus {
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  fileName: string;
  originalSize: number;
  position?: number;
  error?: string;
  compressedSize?: number;
  savedPercent?: number;
  compressed?: boolean;
}

export interface VideoJobHandle {
  jobId: string;
  /** A guest's proof of ownership; signed-in owners are known by their session. */
  token?: string;
}

const ENDED = new Set<VideoJobStatus['status']>(['done', 'failed', 'cancelled']);

export function videoJobPath({ jobId }: VideoJobHandle, suffix = ''): string {
  return `/api/convert/video-compress/jobs/${jobId}${suffix}`;
}

export function videoJobHeaders({ token }: VideoJobHandle): Record<string, string> {
  return token ? { 'X-Job-Token': token } : {};
}

/** The button label while a job is in progress. */
export function videoJobLabel(status: Pick<VideoJobStatus, 'status' | 'position'>): string {
  if (status.status === 'queued') return `Queued (${status.position ?? 0} ahead)…`;
  return 'Compressing…';
}

// A job can run for an hour, so its status is polled hundreds of times, and some polls will
// fail: a dropped mobile connection, or the 5xx Railway answers while a deployment swaps.
// Those are retried with a growing pause. The wait gives up only after failures have gone on
// for two minutes without one successful poll: longer than a deployment swap, and longer
// than the minute a job takes to be requeued when its server dies.
export const VIDEO_JOB_RETRY = {
  firstDelayMs: 2_000,
  maxDelayMs: 15_000,
  giveUpAfterMs: 120_000,
};

/** The status could not be read for too long. The job itself may still be running. */
export class VideoJobUnreachableError extends Error {
  constructor() {
    super('Lost contact with the server.');
    this.name = 'VideoJobUnreachableError';
  }
}

interface WaitOptions {
  signal?: AbortSignal;
  onStatus?: (status: VideoJobStatus) => void;
  fetchImpl?: typeof fetch;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

type Poll = { status: VideoJobStatus } | { retryAfterMs: number | null };

function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get('Retry-After')?.trim();
  return header && /^\d+$/.test(header) ? Number(header) * 1000 : null;
}

/**
 * One status request: the status, a transient failure worth retrying (a network error, 429,
 * 5xx or a body that is not JSON), or a thrown Error for a definite answer such as 404.
 */
async function pollOnce(job: VideoJobHandle, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Poll> {
  let response: Response;
  try {
    response = await fetchImpl(videoJobPath(job), { headers: videoJobHeaders(job), cache: 'no-store', signal });
  } catch {
    if (signal?.aborted) throw new RetryCancelledError();
    return { retryAfterMs: null };
  }

  const body = await response.json().catch(() => null);
  if (response.status === 429 || response.status >= 500) {
    return { retryAfterMs: retryAfterMs(response) };
  }
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'This video job is no longer available.' : body?.error || 'Could not check on the video.');
  }
  return body && typeof body.status === 'string' ? { status: body as VideoJobStatus } : { retryAfterMs: null };
}

/**
 * Polls the job's status until it ends and returns its last status. Transient failures are
 * retried (see VIDEO_JOB_RETRY); once they have lasted too long it rejects with
 * VideoJobUnreachableError. A definite refusal such as 404 rejects at once with its message,
 * and an abort, during a poll or between two, rejects with RetryCancelledError.
 */
export async function waitForVideoJob(
  job: VideoJobHandle,
  { signal, onStatus, fetchImpl = fetch, wait = sleep, now = Date.now }: WaitOptions = {},
): Promise<VideoJobStatus> {
  let failingSince: number | null = null;
  let backoffMs = VIDEO_JOB_RETRY.firstDelayMs;

  for (;;) {
    const poll = await pollOnce(job, fetchImpl, signal);
    if ('status' in poll) {
      failingSince = null;
      backoffMs = VIDEO_JOB_RETRY.firstDelayMs;
      onStatus?.(poll.status);
      if (ENDED.has(poll.status.status)) return poll.status;
      await wait(VIDEO_JOB_POLL_INTERVAL_MS, signal);
      continue;
    }

    failingSince ??= now();
    if (now() - failingSince >= VIDEO_JOB_RETRY.giveUpAfterMs) {
      throw new VideoJobUnreachableError();
    }
    const delayMs = Math.min(poll.retryAfterMs ?? backoffMs, VIDEO_JOB_RETRY.giveUpAfterMs);
    backoffMs = Math.min(backoffMs * 2, VIDEO_JOB_RETRY.maxDelayMs);
    await wait(delayMs, signal);
  }
}

/** The toast for a downloaded result, like Compress PDF's. */
export function videoResultMessage({ savedPercent = 0, originalSize, compressedSize = originalSize }: VideoJobStatus): string {
  if (savedPercent > 0) {
    const savedMb = ((originalSize - compressedSize) / 1024 / 1024).toFixed(1);
    return `Reduced by ${savedPercent}% — ${savedMb} MB saved!`;
  }
  return 'Video was already well-compressed, so it is unchanged.';
}

/**
 * The name to save a finished job's result under: the one its download names, or the
 * input's name with the output's extension, since the result is always MP4.
 */
export function videoResultFileName(download: Response, inputName: string): string {
  const named = fileNameFromDisposition(download.headers.get('Content-Disposition'));
  return named ?? `compressed_${inputName.replace(/\.[^/.]+$/, '')}.mp4`;
}
