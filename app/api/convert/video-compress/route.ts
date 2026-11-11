import { NextRequest, NextResponse } from 'next/server';
import { resolveCaller, type Caller } from '@/lib/auth/caller';
import { CallerJobRefusedError, callerJobRefusedResponse, runCallerJob } from '@/lib/convert/caller-jobs';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { checkVideoUpload } from '@/lib/video/compress';
import { getStorage, type StorageDriver } from '@/lib/storage';
import { enqueueVideoJob, newGuestToken, reasonOf, videoJobCallerKey, videoJobStore } from '@/lib/video/video-job-service';
import { handleConvertError } from '@/lib/convert/errors';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import {
  assertFileSizeWithinPlan,
  COMPRESS_VIDEO_BUSY_MESSAGE,
  encodeLimitsForPlan,
  MAX_QUEUED_VIDEO_JOBS,
  uploadBudgetForPlan,
} from '@/lib/convert/video-compress-limits';
import { readMultipartForm, textField } from '@/lib/http/read-upload';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

// Constant Rate Factor per quality; lower CRF = better quality, larger size.
function crfForQuality(quality: string | null): number {
  if (quality === 'High') return 23;
  if (quality === 'Low') return 32;
  return 28;
}

class QueueFullError extends Error {}

/** The storage the upload would go to cannot be used, e.g. no driver is configured. */
class StorageUnavailableError extends Error {}

function jobStorage(): StorageDriver {
  try {
    return getStorage();
  } catch (error) {
    throw new StorageUnavailableError(`Compress Video is unavailable: ${reasonOf(error)}`, { cause: error });
  }
}

// These checks run before the upload is read, so a refused caller costs nothing.
async function assertMayEnqueue(callerKey: string): Promise<void> {
  const store = videoJobStore();
  if (await store.findActiveByCaller(callerKey)) {
    throw new CallerJobRefusedError('job-in-progress');
  }
  if ((await store.countQueued()) >= MAX_QUEUED_VIDEO_JOBS) {
    throw new QueueFullError();
  }
}

/**
 * Reads and checks the upload, probing it so that a video the job would refuse is refused
 * now, then stores it and queues its job. The encode runs in the background
 * (lib/video/video-job-worker.ts); the caller polls the job's status and downloads it.
 */
async function enqueueUpload(req: NextRequest, caller: Caller): Promise<NextResponse> {
  const callerKey = videoJobCallerKey(req.headers, caller);
  await assertMayEnqueue(callerKey);
  const storage = jobStorage();

  const budget = uploadBudgetForPlan(caller.plan);
  const formData = await readMultipartForm(req, budget);
  const video = (await resolveFiles(formData, 'video', budget))[0] as File;
  const crf = crfForQuality(textField(formData, 'quality'));
  const resolution = textField(formData, 'resolution') || 'Original';

  if (!video) {
    return NextResponse.json({ error: 'No video provided' }, { status: 400 });
  }

  assertFileSizeWithinPlan(caller.plan, video.size);

  const input = Buffer.from(await video.arrayBuffer());
  await checkVideoUpload({
    inputBuffer: input,
    fileName: video.name,
    resolution,
    ...encodeLimitsForPlan(caller.plan),
    signal: req.signal,
  });

  const guestToken = caller.userId ? null : newGuestToken();
  const job = await enqueueVideoJob({
    caller,
    callerKey,
    ownerId: caller.userId ?? guestToken!.ownerId,
    fileName: video.name,
    options: { crf, resolution },
    input,
  }, storage);

  return NextResponse.json(
    { jobId: job.id, status: job.status, ...(guestToken ? { token: guestToken.token } : {}) },
    { status: 202 },
  );
}

export async function POST(req: NextRequest) {
  try {
    assertWithinRateLimit(req);

    const caller = await resolveCaller(req);
    return await runCallerJob(req, caller, () => enqueueUpload(req, caller));
  } catch (error) {
    if (error instanceof CallerJobRefusedError) {
      return callerJobRefusedResponse(error, COMPRESS_VIDEO_BUSY_MESSAGE);
    }
    if (error instanceof QueueFullError) {
      return busyResponse(COMPRESS_VIDEO_BUSY_MESSAGE);
    }
    // No Retry-After: the server has to be configured before an upload can succeed.
    if (error instanceof StorageUnavailableError) {
      console.error(`[convert] ${error.message}`);
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return handleConvertError(error, 'Failed to compress video');
  }
}
