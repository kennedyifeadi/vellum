import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import JSZip from 'jszip';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { compressImage } from '@/lib/image/compress';
import { handleConvertError } from '@/lib/convert/errors';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);

    const formData = await req.formData();
    const images = await resolveFiles(formData, 'images');
    const level = formData.get('level') as string || 'medium';

    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    await dbConnect();
    const user = userId ? await User.findById(userId) : null;
    const plan = user?.plan || 'Free';

    const maxAllowed = resolvePlanLimit(plan, {
      guest: 3,
      Basic: 30,
      Pro: 50,
      Enterprise: 250,
    });

    if (images.length > maxAllowed) {
      return NextResponse.json({
        error: `Your current plan allows up to ${maxAllowed} images per compression.`
      }, { status: 400 });
    }

    // Determine quality map
    let quality = 80;
    if (level === 'low') quality = 90;
    if (level === 'medium') quality = 80;
    if (level === 'high') quality = 60;

    // Process multiple images vs single image
    if (images.length === 1) {
      const file = images[0];
      const buffer = Buffer.from(await file.arrayBuffer());

      const compressedBuffer = await compressImage({ imageBuffer: buffer, quality });

      if (userId) {
        try {
          const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
          await Conversion.create({
            userId,
            toolUsed: 'Compress Image',
            fileName: file.name,
            fileSize: file.size,
            status: 'success',
            metadata: { pages: 1, processedSize: compressedBuffer.length },
            expiresAt
          });
        } catch (recordError) {
          console.error('Failed to record Compress Image conversion:', recordError);
        }
      }

      return new NextResponse(compressedBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': file.type || 'image/jpeg',
          'Content-Disposition': `attachment; filename="compressed_${file.name}"`,
          'X-Original-Size': file.size.toString(),
          'X-Compressed-Size': compressedBuffer.length.toString(),
          'X-Saved-Percent': Math.max(0, Math.round((1 - compressedBuffer.length / file.size) * 100)).toString()
        },
      });
    } else {
      // Multiple Images - Create ZIP
      const zip = new JSZip();
      let totalOriginalSize = 0;
      let totalCompressedSize = 0;

      for (let i = 0; i < images.length; i++) {
        const file = images[i];
        totalOriginalSize += file.size;

        const buffer = Buffer.from(await file.arrayBuffer());
        const compressedBuffer = await compressImage({ imageBuffer: buffer, quality });

        totalCompressedSize += compressedBuffer.length;
        zip.file(file.name, compressedBuffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      if (userId) {
        try {
          const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
          await Conversion.create({
            userId,
            toolUsed: 'Compress Image (Batch)',
            fileName: 'compressed_images.zip',
            fileSize: totalOriginalSize,
            status: 'success',
            metadata: { pages: images.length, processedSize: zipBuffer.length },
            expiresAt
          });
        } catch (recordError) {
          console.error('Failed to record Compress Image conversion:', recordError);
        }
      }

      return new NextResponse(zipBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="compressed_images.zip"`,
        },
      });
    }

  } catch (error) {
    return handleConvertError(error, 'Failed to compress images');
  }
}
