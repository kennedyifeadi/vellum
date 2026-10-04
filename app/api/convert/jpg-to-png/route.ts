import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import JSZip from 'jszip';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { convertJpegToPng } from '@/lib/image/to-png';
import { handleConvertError } from '@/lib/convert/errors';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);

    const formData = await req.formData();
    const images = await resolveFiles(formData, 'images');

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
        error: `Your current plan allows up to ${maxAllowed} images per conversion.`
      }, { status: 400 });
    }

    // Process multiple images vs single image
    if (images.length === 1) {
      const file = images[0];
      const buffer = Buffer.from(await file.arrayBuffer());

      const pngBuffer = await convertJpegToPng({ jpegBuffer: buffer, quality: 100 });

      if (userId) {
        try {
          const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // Expires in 2 hours
          await Conversion.create({
            userId,
            toolUsed: 'JPEG to PNG',
            fileName: file.name,
            fileSize: file.size,
            status: 'success',
            metadata: { pages: 1, processedSize: pngBuffer.length },
            expiresAt
          });
        } catch (recordError) {
          console.error('Failed to record JPEG to PNG conversion:', recordError);
        }
      }

      return new NextResponse(pngBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="converted_${file.name.replace(/\.[^/.]+$/, "")}.png"`,
        },
      });
    } else {
      // Multiple Images - Create ZIP
      const zip = new JSZip();
      let totalOriginalSize = 0;

      for (let i = 0; i < images.length; i++) {
        const file = images[i];
        totalOriginalSize += file.size;

        const buffer = Buffer.from(await file.arrayBuffer());
        const pngBuffer = await convertJpegToPng({ jpegBuffer: buffer, quality: 100 });

        // Ensure unique names and correct extensions inside ZIP
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        zip.file(`${baseName}.png`, pngBuffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      if (userId) {
        try {
          const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // Expires in 2 hours
          await Conversion.create({
            userId,
            toolUsed: 'JPEG to PNG (Batch)',
            fileName: 'converted_images.zip',
            fileSize: totalOriginalSize,
            status: 'success',
            metadata: { pages: images.length, processedSize: zipBuffer.length },
            expiresAt
          });
        } catch (recordError) {
          console.error('Failed to record JPEG to PNG conversion:', recordError);
        }
      }

      return new NextResponse(zipBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="converted_images.zip"`,
        },
      });
    }

  } catch (error) {
    return handleConvertError(error, 'Failed to convert images to PNG');
  }
}
