import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { recordConversionHistory } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { compressVideo, type CompressedVideo } from '@/lib/video/compress';
import { handleConvertError } from '@/lib/convert/errors';
import { encodeLimitsForPlan } from '@/lib/convert/video-compress-limits';

// Constant Rate Factor per quality; lower CRF = better quality, larger size.
function crfForQuality(quality: FormDataEntryValue | null): number {
  if (quality === 'High') return 23;
  if (quality === 'Low') return 32;
  return 28;
}

function outputHeaders(video: File, originalSize: number, output: CompressedVideo): Record<string, string> {
  const stem = video.name.replace(/\.[^/.]+$/, '');
  return {
    'Content-Type': output.format.contentType,
    'Content-Disposition': `attachment; filename="compressed_${stem}.${output.format.extension}"`,
    'X-Original-Size': String(originalSize),
    'X-Compressed-Size': String(output.bytes.length),
    'X-Saved-Percent': String(Math.round((1 - output.bytes.length / originalSize) * 100)),
  };
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);

    const formData = await req.formData();
    const video = (await resolveFiles(formData, 'video'))[0] as File;
    const crf = crfForQuality(formData.get('quality'));
    const resolution = formData.get('resolution') as string || 'Original';

    if (!video) {
      return NextResponse.json({ error: 'No video provided' }, { status: 400 });
    }

    await dbConnect();
    const user = userId ? await User.findById(userId) : null;
    const plan = user?.plan || 'Free';

    const maxSize = resolvePlanLimit(plan, {
      guest: 50 * 1024 * 1024,
      Basic: 100 * 1024 * 1024,
      Pro: 500 * 1024 * 1024,
      Enterprise: 2500 * 1024 * 1024,
    });

    if (video.size > maxSize) {
      return NextResponse.json({
        error: `Your current plan allows videos up to ${maxSize / (1024 * 1024)}MB.`
      }, { status: 400 });
    }

    const inputBuffer = Buffer.from(await video.arrayBuffer());
    const output = await compressVideo({
      inputBuffer,
      fileName: video.name,
      crf,
      resolution,
      ...encodeLimitsForPlan(plan),
      signal: req.signal,
    });

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
  } catch (error) {
    return handleConvertError(error, 'Failed to compress video');
  }
}
