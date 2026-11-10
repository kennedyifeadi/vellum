import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import type { VideoJob } from '@/lib/video/video-job-store';
import { guestTokenOwns, VIDEO_JOB_TOKEN_HEADER, videoJobStore } from '@/lib/video/video-job-service';

/**
 * The job, when the request comes from its owner: a guest by the job's token, a signed-in
 * user by their session. Anyone else is answered as if the job did not exist.
 */
export async function findOwnedVideoJob(req: NextRequest, id: string): Promise<VideoJob | null> {
  const job = await videoJobStore().get(id);
  if (!job) return null;

  if (job.guest) {
    const token = req.headers.get(VIDEO_JOB_TOKEN_HEADER);
    return token && guestTokenOwns(token, job.ownerId) ? job : null;
  }
  const userId = await getAuthUserId(req);
  return userId === job.ownerId ? job : null;
}

export function videoJobNotFound(): NextResponse {
  return NextResponse.json({ error: 'Job not found' }, { status: 404 });
}

export function savedPercent(originalSize: number, compressedSize: number): number {
  return Math.round((1 - compressedSize / originalSize) * 100);
}

export function resultExpired(job: VideoJob, now = Date.now()): boolean {
  return !job.outputKey || !job.resultExpiresAt || job.resultExpiresAt.getTime() <= now;
}
