import { NextRequest, NextResponse } from 'next/server';
import { compressPdf } from '@/lib/pdf/compress';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';

const COMPRESSION_LEVELS = ['low', 'medium', 'high'] as const;
type CompressionLevel = (typeof COMPRESSION_LEVELS)[number];

export async function POST(req: NextRequest) {
  let file: File | undefined;
  let compressed;
  let userId: string | null = null;

  try {
    const formData = await req.formData();
    file = (await resolveFiles(formData, 'pdf'))[0] as File;

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided.' }, { status: 400 });
    }

    const rawLevel = (formData.get('level') as string | null)?.trim() || '';
    if (rawLevel && !COMPRESSION_LEVELS.includes(rawLevel as CompressionLevel)) {
      throw new ClientError(
        `Invalid compression level. Use one of: ${COMPRESSION_LEVELS.join(', ')}.`,
      );
    }
    const level: CompressionLevel = (rawLevel as CompressionLevel) || 'medium';

    userId = await getAuthUserId(req);
    let plan = 'Free';
    if (userId) {
      await dbConnect();
      const user = await User.findById(userId);
      plan = user?.plan || 'Free';
    }

    const maxSize = resolvePlanLimit(plan, {
      guest: 25 * 1024 * 1024,
      Basic: 50 * 1024 * 1024,
      Pro: 100 * 1024 * 1024,
      Enterprise: 500 * 1024 * 1024,
    });

    if (file.size > maxSize) {
      throw new ClientError(
        `Your current plan allows PDFs up to ${maxSize / (1024 * 1024)}MB.`,
      );
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    compressed = await compressPdf({ pdfBuffer, level });
  } catch (error) {
    return handleConvertError(error, 'Failed to compress PDF.');
  }

  const { buffer: compressedPdfBuffer, originalSize, compressedSize } = compressed;

  try {
    if (userId) {
      const originalFileName = file?.name ? `compressed_${file.name}` : 'compressed.pdf';
      await saveConversionRecord(userId, 'Compress PDF', originalFileName, compressedPdfBuffer);
    }
  } catch (recordError) {
    console.error('Failed to record Compress PDF conversion:', recordError);
  }

  const savedBytes = originalSize - compressedSize;
  const savedPercent = originalSize > 0 ? Math.max(0, Math.round((savedBytes / originalSize) * 100)) : 0;

  return new NextResponse(compressedPdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="compressed_${file.name || 'document.pdf'}"`,
      'X-Original-Size': String(originalSize),
      'X-Compressed-Size': String(compressedSize),
      'X-Saved-Percent': String(savedPercent),
    },
  });
}
