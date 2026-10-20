import { MAX_CONCURRENT_VIDEO_ENCODES } from '@/lib/convert/video-compress-limits';

export class VideoToolBusyError extends Error {
  constructor() {
    super('Too many video encodes are already running');
    this.name = 'VideoToolBusyError';
  }
}

let activeJobs = 0;

/**
 * Runs one request's video work, or refuses at once with `VideoToolBusyError` when
 * `MAX_CONCURRENT_VIDEO_ENCODES` are already running. ffmpeg runs in a child process,
 * so what this bounds is the CPU cores and temp disk those processes take.
 */
export async function runVideoJob<Result>(work: () => Promise<Result>): Promise<Result> {
  if (activeJobs >= MAX_CONCURRENT_VIDEO_ENCODES) {
    throw new VideoToolBusyError();
  }

  activeJobs += 1;
  try {
    return await work();
  } finally {
    activeJobs -= 1;
  }
}
