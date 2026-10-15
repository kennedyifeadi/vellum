import { MAX_CONCURRENT_IMAGE_JOBS } from '@/lib/convert/image-limits';

export class ImageToolBusyError extends Error {
  constructor() {
    super('Too many image jobs are already running');
    this.name = 'ImageToolBusyError';
  }
}

// One count for every tool that re-encodes images with sharp. sharp runs on libvips's
// own threads, so the event loop stays free however many run; what they share is that
// thread pool and the process's memory, which is what this count bounds.
let activeJobs = 0;

/**
 * Runs one request's image work, or refuses at once with `ImageToolBusyError` when
 * `MAX_CONCURRENT_IMAGE_JOBS` are already running. The images of one request are worked
 * on one at a time inside `work`, so the count bounds how many are decoded at once.
 */
export async function runImageJob<Result>(work: () => Promise<Result>): Promise<Result> {
  if (activeJobs >= MAX_CONCURRENT_IMAGE_JOBS) {
    throw new ImageToolBusyError();
  }

  activeJobs += 1;
  try {
    return await work();
  } finally {
    activeJobs -= 1;
  }
}
