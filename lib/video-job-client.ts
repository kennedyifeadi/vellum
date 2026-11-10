import { RetryCancelledError, sleep } from '@/lib/busy-retry';

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

interface WaitOptions {
  signal?: AbortSignal;
  onStatus?: (status: VideoJobStatus) => void;
  fetchImpl?: typeof fetch;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Polls the job's status until it ends and returns its last status. Rejects with the
 * server's message when a status request fails, and with RetryCancelledError when `signal`
 * aborts, during a poll or between two.
 */
export async function waitForVideoJob(
  job: VideoJobHandle,
  { signal, onStatus, fetchImpl = fetch, wait = sleep }: WaitOptions = {},
): Promise<VideoJobStatus> {
  for (;;) {
    let response: Response;
    try {
      response = await fetchImpl(videoJobPath(job), { headers: videoJobHeaders(job), cache: 'no-store', signal });
    } catch (error) {
      if (signal?.aborted) throw new RetryCancelledError();
      throw error;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || 'Could not check on the video.');
    }
    const status = body as VideoJobStatus;
    onStatus?.(status);
    if (ENDED.has(status.status)) return status;
    await wait(VIDEO_JOB_POLL_INTERVAL_MS, signal);
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
