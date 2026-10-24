import { NextRequest, NextResponse } from 'next/server';
import { resolveCaller, type Caller } from '@/lib/auth/caller';
import { CallerJobRefusedError, callerJobRefusedResponse, runCallerJob } from '@/lib/convert/caller-jobs';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { recordConversionHistory } from '@/lib/conversions';
import JSZip from 'jszip';
import {
  acceptImageToCompress,
  compressImage,
  compressionLevel,
  CONTENT_TYPES,
  FILE_EXTENSIONS,
  type CompressionLevel,
} from '@/lib/image/compress';
import type { AcceptedImage } from '@/lib/image/input';
import { ImageToolBusyError, runImageJob } from '@/lib/image/image-jobs';
import { handleConvertError } from '@/lib/convert/errors';
import {
  assertFileCountWithinPlan,
  assertTotalSizeWithinPlan,
  COMPRESS_IMAGE_BUSY_MESSAGE,
  uploadBudgetForPlan,
} from '@/lib/convert/image-compress-limits';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import { bareFileStem, claimUniqueName } from '@/lib/paths';
import { readMultipartForm, textField } from '@/lib/http/read-upload';
import { attachmentDisposition } from '@/lib/http/content-disposition';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

interface CompressedOutput {
  toolUsed: string;
  /** The name and size the history row records: the upload's, or the batch's. */
  recordedName: string;
  recordedSize: number;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  headers?: Record<string, string>;
}

async function compressSingle(image: AcceptedImage, file: File, level: CompressionLevel): Promise<CompressedOutput> {
  const bytes = await compressImage(image, level);
  const originalSize = image.bytes.length;

  return {
    toolUsed: 'Compress Image',
    recordedName: file.name,
    recordedSize: file.size,
    fileName: `compressed_${file.name.replace(/\.[^/.]+$/, '')}.${FILE_EXTENSIONS[image.format]}`,
    contentType: CONTENT_TYPES[image.format],
    bytes,
    headers: {
      'X-Original-Size': String(originalSize),
      'X-Compressed-Size': String(bytes.length),
      'X-Saved-Percent': String(Math.round((1 - bytes.length / originalSize) * 100)),
    },
  };
}

async function compressBatch(images: AcceptedImage[], files: File[], level: CompressionLevel): Promise<CompressedOutput> {
  const zip = new JSZip();
  const entryNames = new Set<string>();

  for (const [i, image] of images.entries()) {
    const compressed = await compressImage(image, level);
    const stem = bareFileStem(files[i].name, `image-${i + 1}`);
    zip.file(claimUniqueName(`${stem}.${FILE_EXTENSIONS[image.format]}`, entryNames), compressed);
  }

  return {
    toolUsed: 'Compress Image (Batch)',
    recordedName: 'compressed_images.zip',
    recordedSize: files.reduce((total, file) => total + file.size, 0),
    fileName: 'compressed_images.zip',
    contentType: 'application/zip',
    bytes: await zip.generateAsync({ type: 'nodebuffer' }),
  };
}

async function recordCompression(userId: string, output: CompressedOutput, pages: number): Promise<void> {
  try {
    await recordConversionHistory(userId, output.toolUsed, output.recordedName, output.recordedSize, {
      pages,
      processedSize: output.bytes.length,
    });
  } catch (recordError) {
    console.error('Failed to record Compress Image conversion:', recordError);
  }
}

async function compressUpload(req: NextRequest, { userId, plan }: Caller): Promise<NextResponse> {
  const budget = uploadBudgetForPlan(plan);
  const formData = await readMultipartForm(req, budget);
  const images = await resolveFiles(formData, 'images', budget);
  const level = compressionLevel(textField(formData, 'level'));

  if (!images || images.length === 0) {
    return NextResponse.json({ error: 'No images provided' }, { status: 400 });
  }

  assertFileCountWithinPlan(plan, images.length);
  assertTotalSizeWithinPlan(
    plan,
    images.map((image) => image.size),
  );

  const accepted: AcceptedImage[] = [];
  for (const [index, file] of images.entries()) {
    accepted.push(await acceptImageToCompress(Buffer.from(await file.arrayBuffer()), index + 1));
  }

  const output = await runImageJob(() =>
    accepted.length === 1 ? compressSingle(accepted[0], images[0], level) : compressBatch(accepted, images, level),
  );

  // Built before anything is recorded, so a response that cannot be built leaves no
  // history row behind.
  const response = new NextResponse(output.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': output.contentType,
      'Content-Disposition': attachmentDisposition(output.fileName, 'compressed_image'),
      ...output.headers,
    },
  });

  if (userId) {
    await recordCompression(userId, output, images.length);
  }

  return response;
}

export async function POST(req: NextRequest) {
  try {
    assertWithinRateLimit(req);

    const caller = await resolveCaller(req);
    return await runCallerJob(req, caller, ['image'], () => compressUpload(req, caller));
  } catch (error) {
    if (error instanceof CallerJobRefusedError) {
      return callerJobRefusedResponse(error, COMPRESS_IMAGE_BUSY_MESSAGE);
    }
    if (error instanceof ImageToolBusyError) {
      return busyResponse(COMPRESS_IMAGE_BUSY_MESSAGE);
    }
    return handleConvertError(error, 'Failed to compress images');
  }
}
