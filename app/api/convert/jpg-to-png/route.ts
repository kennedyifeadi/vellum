import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { saveConversionRecord } from '@/lib/conversions';
import JSZip from 'jszip';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { convertJpegToPng } from '@/lib/image/to-png';
import { handleConvertError } from '@/lib/convert/errors';
import { bareFileName, claimUniqueName } from '@/lib/paths';

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
      const outputFileName = `converted_${file.name.replace(/\.[^/.]+$/, "")}.png`;

      if (userId) {
        try {
          await saveConversionRecord(userId, 'JPEG to PNG', outputFileName, pngBuffer, {
            pages: 1,
            processedSize: pngBuffer.length,
          });
        } catch (recordError) {
          console.error('Failed to record JPEG to PNG conversion:', recordError);
        }
      }

      return new NextResponse(pngBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="${outputFileName}"`,
        },
      });
    } else {
      // Multiple Images - Create ZIP
      const zip = new JSZip();
      const entryNames = new Set<string>();

      for (let i = 0; i < images.length; i++) {
        const file = images[i];
        const buffer = Buffer.from(await file.arrayBuffer());
        const pngBuffer = await convertJpegToPng({ jpegBuffer: buffer, quality: 100 });

        const baseName = bareFileName(file.name, `image-${i + 1}`).replace(/\.[^.]+$/, '') || `image-${i + 1}`;
        zip.file(claimUniqueName(`${baseName}.png`, entryNames), pngBuffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      if (userId) {
        try {
          await saveConversionRecord(userId, 'JPEG to PNG (Batch)', 'converted_images.zip', zipBuffer, {
            pages: images.length,
            processedSize: zipBuffer.length,
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
