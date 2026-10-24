import { NextRequest, NextResponse } from 'next/server';
import { resolveCaller, type Caller } from '@/lib/auth/caller';
import { CallerJobRefusedError, callerJobRefusedResponse, runCallerJob, type CallerJob } from '@/lib/convert/caller-jobs';
import { recordConversionHistory } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { compressVideo, type CompressedVideo } from '@/lib/video/compress';
import { runVideoJob, VideoToolBusyError } from '@/lib/video/video-jobs';
import { handleConvertError } from '@/lib/convert/errors';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import {
  assertFileSizeWithinPlan,
  COMPRESS_VIDEO_BUSY_MESSAGE,
  encodeLimitsForPlan,
  uploadBudgetForPlan,
} from '@/lib/convert/video-compress-limits';
import { readMultipartForm, textField } from '@/lib/http/read-upload';
import { attachmentDisposition } from '@/lib/http/content-disposition';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

// Constant Rate Factor per quality; lower CRF = better quality, larger size.
function crfForQuality(quality: string | null): number {
  if (quality === 'High') return 23;
  if (quality === 'Low') return 32;
  return 28;
}

function outputHeaders(video: File, originalSize: number, output: CompressedVideo): Record<string, string> {
  const stem = video.name.replace(/\.[^/.]+$/, '');
  return {
    'Content-Type': output.format.contentType,
    'Content-Disposition': attachmentDisposition(
      `compressed_${stem}.${output.format.extension}`,
      `compressed_video.${output.format.extension}`,
    ),
    'X-Original-Size': String(originalSize),
    'X-Compressed-Size': String(output.bytes.length),
    'X-Saved-Percent': String(Math.round((1 - output.bytes.length / originalSize) * 100)),
  };
}

async function compressUpload(req: NextRequest, { userId, plan }: Caller, job: CallerJob): Promise<NextResponse> {
  const budget = uploadBudgetForPlan(plan);
  const formData = await readMultipartForm(req, budget);
  const video = (await resolveFiles(formData, 'video', budget))[0] as File;
  const crf = crfForQuality(textField(formData, 'quality'));
  const resolution = textField(formData, 'resolution') || 'Original';

  if (!video) {
    return NextResponse.json({ error: 'No video provided' }, { status: 400 });
  }

  assertFileSizeWithinPlan(plan, video.size);

  const inputBuffer = Buffer.from(await video.arrayBuffer());
  const output = await job.inPools(['video'], () =>
    runVideoJob(() =>
      compressVideo({
        inputBuffer,
        fileName: video.name,
        crf,
        resolution,
        ...encodeLimitsForPlan(plan),
        signal: req.signal,
      }),
    ),
  );

  // Built before anything is recorded, so a response that cannot be built leaves no
  // history row behind.
  const response = new NextResponse(output.bytes as unknown as BodyInit, {
    headers: outputHeaders(video, inputBuffer.length, output),
  });

  if (userId) {
    try {
      await recordConversionHistory(userId, 'Compress Video', video.name, video.size, {
        pages: 1,
        processedSize: output.bytes.length,
      });
    } catch (recordError) {
      console.error('Failed to record Compress Video conversion:', recordError);
    }
  }

  return response;
}

export async function POST(req: NextRequest) {
  try {
    assertWithinRateLimit(req);

    const caller = await resolveCaller(req);
    return await runCallerJob(req, caller, (job) => compressUpload(req, caller, job));
  } catch (error) {
    if (error instanceof CallerJobRefusedError) {
      return callerJobRefusedResponse(error, COMPRESS_VIDEO_BUSY_MESSAGE);
    }
    if (error instanceof VideoToolBusyError) {
      return busyResponse(COMPRESS_VIDEO_BUSY_MESSAGE);
    }
    return handleConvertError(error, 'Failed to compress video');
  }
}
