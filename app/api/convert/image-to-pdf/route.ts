import { NextRequest, NextResponse } from 'next/server';
import { convertImagesToPdf } from '@/lib/image/to-pdf';
import { resolveCaller, type Caller } from '@/lib/auth/caller';
import { CallerJobRefusedError, callerJobRefusedResponse, runCallerJob } from '@/lib/convert/caller-jobs';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import {
  assertFileCountWithinPlan,
  assertTotalSizeWithinPlan,
  conversionLimitsForPlan,
  IMAGE_TO_PDF_BUSY_MESSAGE,
  IMAGES_TOO_COMPLEX_MESSAGE,
  uploadBudgetForPlan,
} from '@/lib/convert/image-to-pdf-limits';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import { WorkerJobError } from '@/lib/convert/worker-job';
import { ImageToolBusyError } from '@/lib/image/image-jobs';
import { bareFileStem } from '@/lib/paths';
import { readMultipartForm } from '@/lib/http/read-upload';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

// The images are decoded in one of the image tools' slots, then assembled in one of the
// PDF workers' slots; either can be full.
function isBusy(error: unknown): boolean {
  return error instanceof ImageToolBusyError || (error instanceof WorkerJobError && error.reason === 'busy');
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

async function convertUpload(req: NextRequest, { userId, plan }: Caller): Promise<NextResponse> {
  const budget = uploadBudgetForPlan(plan);
  const formData = await readMultipartForm(req, budget);
  const files = await resolveFiles(formData, 'images', budget);

  if (!files || files.length === 0) {
    return NextResponse.json({ error: 'No image files provided.' }, { status: 400 });
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

  // Built before anything is recorded, so a response that cannot be built leaves no
  // history row behind.
  const response = new NextResponse(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="converted_images.pdf"',
    },
  });

  if (userId) {
    try {
      const recordedName = `${bareFileStem(files[0].name, 'converted_images')}.pdf`;
      await saveConversionRecord(userId, 'Image to PDF', recordedName, Buffer.from(pdfBuffer));
    } catch (recordError) {
      console.error('Failed to record Image to PDF conversion:', recordError);
    }
  }

  return response;
}

export async function POST(req: NextRequest) {
  try {
    assertWithinRateLimit(req);

    const caller = await resolveCaller(req);
    return await runCallerJob(req, caller, ['image', 'pdf-worker'], () => convertUpload(req, caller));
  } catch (error) {
    if (error instanceof CallerJobRefusedError) {
      return callerJobRefusedResponse(error, IMAGE_TO_PDF_BUSY_MESSAGE);
    }
    if (isBusy(error)) {
      return busyResponse(IMAGE_TO_PDF_BUSY_MESSAGE);
    }
    return handleConvertError(error, 'Failed to convert images to PDF.');
  }
}
