import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { recordConversionHistory, saveConversionRecord } from '@/lib/conversions';
import JSZip from 'jszip';
import { acceptJpeg, convertJpegToPng } from '@/lib/image/to-png';
import type { AcceptedImage } from '@/lib/image/input';
import { ImageToolBusyError, runImageJob } from '@/lib/image/image-jobs';
import { handleConvertError } from '@/lib/convert/errors';
import {
  assertFileCountWithinPlan,
  assertTotalSizeWithinPlan,
  JPEG_TO_PNG_BUSY_MESSAGE,
  MAX_STORED_OUTPUT_SIZE,
} from '@/lib/convert/jpg-to-png-limits';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import { bareFileStem, claimUniqueName } from '@/lib/paths';

interface ConvertedOutput {
  toolUsed: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

async function convertSingle(jpeg: AcceptedImage, file: File): Promise<ConvertedOutput> {
  return {
    toolUsed: 'JPEG to PNG',
    fileName: `converted_${file.name.replace(/\.[^/.]+$/, "")}.png`,
    contentType: 'image/png',
    bytes: await convertJpegToPng(jpeg),
  };
}

async function convertBatch(jpegs: AcceptedImage[], files: File[]): Promise<ConvertedOutput> {
  const zip = new JSZip();
  const entryNames = new Set<string>();

  for (const [i, jpeg] of jpegs.entries()) {
    const pngBuffer = await convertJpegToPng(jpeg);
    zip.file(claimUniqueName(`${bareFileStem(files[i].name, `image-${i + 1}`)}.png`, entryNames), pngBuffer);
  }

  return {
    toolUsed: 'JPEG to PNG (Batch)',
    fileName: 'converted_images.zip',
    contentType: 'application/zip',
    bytes: await zip.generateAsync({ type: 'nodebuffer' }),
  };
}

async function recordConversion(userId: string, output: ConvertedOutput, pages: number): Promise<void> {
  const metadata = { pages, processedSize: output.bytes.length };
  try {
    if (output.bytes.length <= MAX_STORED_OUTPUT_SIZE) {
      await saveConversionRecord(userId, output.toolUsed, output.fileName, output.bytes, metadata);
    } else {
      await recordConversionHistory(userId, output.toolUsed, output.fileName, output.bytes.length, metadata);
    }
  } catch (recordError) {
    console.error('Failed to record JPEG to PNG conversion:', recordError);
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const images = await resolveFiles(formData, 'images');

    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    const userId = await getAuthUserId(req);
    let plan = 'Free';
    if (userId) {
      await dbConnect();
      const user = await User.findById(userId);
      plan = user?.plan || 'Free';
    }

    assertFileCountWithinPlan(plan, images.length);
    assertTotalSizeWithinPlan(
      plan,
      images.map((image) => image.size),
    );

    const jpegs: AcceptedImage[] = [];
    for (const [index, file] of images.entries()) {
      jpegs.push(await acceptJpeg(Buffer.from(await file.arrayBuffer()), index + 1));
    }

    const output = await runImageJob(() =>
      jpegs.length === 1 ? convertSingle(jpegs[0], images[0]) : convertBatch(jpegs, images),
    );

    // Built before anything is recorded, so a response that cannot be built leaves no
    // stored file and no history row behind.
    const response = new NextResponse(output.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': output.contentType,
        'Content-Disposition': `attachment; filename="${output.fileName}"`,
      },
    });

    if (userId) {
      await recordConversion(userId, output, images.length);
    }

    return response;
  } catch (error) {
    if (error instanceof ImageToolBusyError) {
      return busyResponse(JPEG_TO_PNG_BUSY_MESSAGE);
    }
    return handleConvertError(error, 'Failed to convert images to PNG');
  }
}
