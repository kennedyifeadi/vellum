import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { recordConversionHistory } from '@/lib/conversions';
import JSZip from 'jszip';
import { resolvePlanLimit } from '@/lib/plan-limits';
import {
  acceptImageToCompress,
  compressImage,
  compressionLevel,
  CONTENT_TYPES,
  FILE_EXTENSIONS,
  type CompressionLevel,
} from '@/lib/image/compress';
import type { AcceptedImage } from '@/lib/image/input';
import { handleConvertError } from '@/lib/convert/errors';
import { bareFileStem, claimUniqueName } from '@/lib/paths';

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

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);

    const formData = await req.formData();
    const images = await resolveFiles(formData, 'images');
    const level = compressionLevel(formData.get('level'));

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

    const accepted: AcceptedImage[] = [];
    for (const [index, file] of images.entries()) {
      accepted.push(await acceptImageToCompress(Buffer.from(await file.arrayBuffer()), index + 1));
    }

    const output =
      accepted.length === 1
        ? await compressSingle(accepted[0], images[0], level)
        : await compressBatch(accepted, images, level);

    // Built before anything is recorded, so a response that cannot be built leaves no
    // history row behind.
    const response = new NextResponse(output.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': output.contentType,
        'Content-Disposition': `attachment; filename="${output.fileName}"`,
        ...output.headers,
      },
    });

    if (userId) {
      await recordCompression(userId, output, images.length);
    }

    return response;
  } catch (error) {
    return handleConvertError(error, 'Failed to compress images');
  }
}
