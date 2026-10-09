import { NextRequest, NextResponse } from 'next/server';
import { convertImagesToPdf } from '@/lib/image/to-pdf';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import {
  assertFileCountWithinPlan,
  assertTotalSizeWithinPlan,
  conversionLimitsForPlan,
  IMAGE_TO_PDF_BUSY_MESSAGE,
  IMAGES_TOO_COMPLEX_MESSAGE,
} from '@/lib/convert/image-to-pdf-limits';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import { WorkerJobError } from '@/lib/convert/worker-job';

function isBusy(error: unknown): boolean {
  return error instanceof WorkerJobError && error.reason === 'busy';
}

async function convertWithinPlan(imageBuffers: Buffer[], plan: string): Promise<Buffer> {
  try {
    return await convertImagesToPdf({ imageBuffers, limits: conversionLimitsForPlan(plan) });
  } catch (error) {
    if (error instanceof WorkerJobError && (error.reason === 'deadline' || error.reason === 'memory')) {
      throw new ClientError(IMAGES_TOO_COMPLEX_MESSAGE);
    }
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = await resolveFiles(formData, 'images');

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No image files provided.' }, { status: 400 });
    }

    const userId = await getAuthUserId(req);
    let plan = 'Free';
    if (userId) {
      await dbConnect();
      const user = await User.findById(userId);
      plan = user?.plan || 'Free';
    }

    assertFileCountWithinPlan(plan, files.length);
    assertTotalSizeWithinPlan(
      plan,
      files.map((file) => file.size),
    );

    const imageBuffers: Buffer[] = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      imageBuffers.push(Buffer.from(arrayBuffer));
    }

    const pdfBuffer = await convertWithinPlan(imageBuffers, plan);

    if (userId) {
      try {
        const originalFileName = files[0]?.name ? `${files[0].name.split('.')[0]}.pdf` : 'converted_images.pdf';
        await saveConversionRecord(userId, 'Image to PDF', originalFileName, Buffer.from(pdfBuffer));
      } catch (recordError) {
        console.error('Failed to record Image to PDF conversion:', recordError);
      }
    }

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="converted_images.pdf"',
      },
    });
  } catch (error) {
    if (isBusy(error)) {
      return busyResponse(IMAGE_TO_PDF_BUSY_MESSAGE);
    }
    return handleConvertError(error, 'Failed to convert images to PDF.');
  }
}
