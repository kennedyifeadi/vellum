import { NextRequest, NextResponse } from 'next/server';
import { cancelVideoJob, videoJobStore } from '@/lib/video/video-job-service';
import { findOwnedVideoJob, savedPercent, videoJobNotFound } from '@/lib/video/video-job-access';
import type { VideoJob } from '@/lib/video/video-job-store';

type JobRoute = { params: Promise<{ id: string }> };

async function statusOf(job: VideoJob) {
  const done = job.status === 'done' && job.outputSize !== null;
  return {
    status: job.status,
    fileName: job.fileName,
    originalSize: job.originalSize,
    ...(job.status === 'queued' ? { position: await videoJobStore().jobsAhead(job) } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(done
      ? {
          compressedSize: job.outputSize,
          savedPercent: savedPercent(job.originalSize, job.outputSize!),
          compressed: job.compressed,
          expiresAt: job.resultExpiresAt?.toISOString(),
        }
      : {}),
  };
}

export async function GET(req: NextRequest, { params }: JobRoute) {
  try {
    const job = await findOwnedVideoJob(req, (await params).id);
    if (!job) return videoJobNotFound();
    return NextResponse.json(await statusOf(job));
  } catch (error) {
    console.error('Failed to read a video job:', error);
    return NextResponse.json({ error: 'Failed to read the job' }, { status: 500 });
  }
}

/** Cancels a queued or running job. A job that has already ended is left as it is. */
export async function DELETE(req: NextRequest, { params }: JobRoute) {
  try {
    const job = await findOwnedVideoJob(req, (await params).id);
    if (!job) return videoJobNotFound();

    const cancelled = await cancelVideoJob(job.id);
    return NextResponse.json({ status: cancelled ? cancelled.status : job.status });
  } catch (error) {
    console.error('Failed to cancel a video job:', error);
    return NextResponse.json({ error: 'Failed to cancel the job' }, { status: 500 });
  }
}
