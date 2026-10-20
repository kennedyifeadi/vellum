import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

// ffmpeg's log starts with the input's description, which the probe reads, and ends
// with the lines that explain a failure. A file with thousands of streams or errors can
// make the middle as long as it likes, so only the two ends are kept.
const STDERR_HEAD_CHARS = 64 * 1024;
const STDERR_TAIL_CHARS = 8 * 1024;

class LogEnds {
  private head = '';
  private tail = '';
  private overflowed = false;

  append(chunk: string): void {
    if (!this.overflowed && this.head.length + chunk.length <= STDERR_HEAD_CHARS) {
      this.head += chunk;
      return;
    }
    this.overflowed = true;
    this.tail = (this.tail + chunk).slice(-STDERR_TAIL_CHARS);
  }

  toString(): string {
    return this.overflowed ? `${this.head}\n[...]\n${this.tail}` : this.head;
  }
}

export type FfmpegStopReason = 'deadline' | 'aborted';

export class FfmpegStoppedError extends Error {
  readonly reason: FfmpegStopReason;

  constructor(reason: FfmpegStopReason) {
    super(reason === 'deadline' ? 'ffmpeg exceeded its deadline' : 'ffmpeg was stopped because the request was aborted');
    this.name = 'FfmpegStoppedError';
    this.reason = reason;
  }
}

export class FfmpegExitError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(exitCode: number | null, stderr: string) {
    super(`ffmpeg exited with code ${exitCode}: ${stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
    this.name = 'FfmpegExitError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export interface FfmpegRun {
  args: string[];
  deadlineMs: number;
  signal?: AbortSignal;
  /** Receives stdout as it arrives; stdout is discarded when not given. */
  onStdout?: (chunk: string) => void;
}

/**
 * Runs the bundled ffmpeg and resolves with its stderr once it exits with code 0.
 *
 * When the deadline passes or `signal` aborts, the process is killed and the returned
 * promise rejects with `FfmpegStoppedError` only after the process has exited, so the
 * caller can remove the files it was using (Windows refuses to delete an open file).
 */
export function runFfmpeg({ args, deadlineMs, signal, onStdout }: FfmpegRun): Promise<string> {
  if (!ffmpegStatic) {
    return Promise.reject(new Error('The bundled ffmpeg binary is missing'));
  }
  if (signal?.aborted) {
    return Promise.reject(new FfmpegStoppedError('aborted'));
  }

  const child = spawn(ffmpegStatic, ['-hide_banner', '-nostdin', ...args], {
    stdio: ['ignore', onStdout ? 'pipe' : 'ignore', 'pipe'],
    windowsHide: true,
  });

  return new Promise<string>((resolve, reject) => {
    const stderr = new LogEnds();
    let stopReason: FfmpegStopReason | null = null;

    const stop = (reason: FfmpegStopReason) => {
      stopReason ??= reason;
      child.kill('SIGKILL');
    };
    const onAbort = () => stop('aborted');
    const deadline = setTimeout(() => stop('deadline'), deadlineMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => stderr.append(chunk));
    if (onStdout) {
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', onStdout);
    }

    child.once('error', (error) => {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.once('close', (exitCode) => {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', onAbort);
      if (stopReason) {
        reject(new FfmpegStoppedError(stopReason));
      } else if (exitCode === 0) {
        resolve(stderr.toString());
      } else {
        reject(new FfmpegExitError(exitCode, stderr.toString()));
      }
    });
  });
}
