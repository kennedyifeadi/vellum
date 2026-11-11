import { NextRequest, NextResponse } from 'next/server';
import { attachmentDisposition } from '@/lib/http/content-disposition';
import { getStorage } from '@/lib/storage';
import { findOwnedVideoJob, resultExpired, savedPercent, videoJobNotFound } from '@/lib/video/video-job-access';

const EXPIRED_MESSAGE = 'This compressed video is no longer available. Results are kept for 24 hours.';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const job = await findOwnedVideoJob(req, (await params).id);
    if (!job) return videoJobNotFound();
    if (job.status !== 'done') {
      return NextResponse.json({ error: 'This video has not been compressed yet.' }, { status: 409 });
    }

    const bytes = resultExpired(job) ? null : await getStorage().get(job.outputKey!);
    if (!bytes || !job.outputFormat) {
      return NextResponse.json({ error: EXPIRED_MESSAGE }, { status: 410 });
    }

    const { extension, contentType } = job.outputFormat;
    const stem = job.fileName.replace(/\.[^/.]+$/, '');
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': attachmentDisposition(`compressed_${stem}.${extension}`, `compressed_video.${extension}`),
        'X-Original-Size': String(job.originalSize),
        'X-Compressed-Size': String(bytes.length),
        'X-Saved-Percent': String(savedPercent(job.originalSize, bytes.length)),
      },
    });
  } catch (error) {
    console.error('Failed to download a compressed video:', error);
    return NextResponse.json({ error: 'Failed to download the video' }, { status: 500 });
  }
}
