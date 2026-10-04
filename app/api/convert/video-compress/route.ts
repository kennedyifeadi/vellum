import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { compressVideo } from '@/lib/video/compress';
import { handleConvertError } from '@/lib/convert/errors';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);

    const formData = await req.formData();
    const video = (await resolveFiles(formData, 'video'))[0] as File;
    const quality = formData.get('quality') as string || 'Medium';
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

    // Map quality to Constant Rate Factor (CRF); lower CRF = better quality, larger size.
    let crf = 28;
    if (quality === 'High') crf = 23;
    else if (quality === 'Medium') crf = 28;
    else if (quality === 'Low') crf = 32;

    const arrayBuffer = await video.arrayBuffer();
    const compressedBuffer = await compressVideo({
      inputBuffer: Buffer.from(arrayBuffer),
      fileName: video.name,
      crf,
      resolution,
    });

    if (userId) {
      try {
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
        await Conversion.create({
          userId,
          toolUsed: 'Compress Video',
          fileName: video.name,
          fileSize: video.size,
          status: 'success',
          metadata: { pages: 1, processedSize: compressedBuffer.length },
          expiresAt
        });
      } catch (recordError) {
        console.error('Failed to record Compress Video conversion:', recordError);
      }
    }

    return new NextResponse(compressedBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="compressed_${video.name.replace(/\.[^/.]+$/, "")}.mp4"`,
      },
    });

  } catch (error) {
    return handleConvertError(error, 'Failed to compress video');
  }
}
