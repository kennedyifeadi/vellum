import { NextRequest, NextResponse } from 'next/server';
import { compressPdf } from '@/lib/pdf/compress';
import { resolveCaller } from '@/lib/auth/caller';
import { saveConversionRecord } from '@/lib/conversions';
import { ensureExtension } from '@/lib/paths';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import { readMultipartForm, textField, uploadBudget } from '@/lib/http/read-upload';
import { attachmentDisposition } from '@/lib/http/content-disposition';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

const COMPRESSION_LEVELS = ['low', 'medium', 'high'] as const;
type CompressionLevel = (typeof COMPRESSION_LEVELS)[number];

export async function POST(req: NextRequest) {
  let file: File | undefined;
  let compressed;
  let userId: string | null = null;

  try {
    assertWithinRateLimit(req);

    const caller = await resolveCaller(req);
    userId = caller.userId;

    const maxSize = resolvePlanLimit(caller.plan, {
      guest: 25 * 1024 * 1024,
      Basic: 50 * 1024 * 1024,
      Pro: 100 * 1024 * 1024,
      Enterprise: 500 * 1024 * 1024,
    });
    const budget = uploadBudget(maxSize, `Your current plan allows PDFs up to ${maxSize / (1024 * 1024)}MB.`);

    const formData = await readMultipartForm(req, budget);
    file = (await resolveFiles(formData, 'pdf', budget))[0] as File;

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided.' }, { status: 400 });
    }

    const rawLevel = textField(formData, 'level')?.trim() || '';
    if (rawLevel && !COMPRESSION_LEVELS.includes(rawLevel as CompressionLevel)) {
      throw new ClientError(
        `Invalid compression level. Use one of: ${COMPRESSION_LEVELS.join(', ')}.`,
      );
    }
    const level: CompressionLevel = (rawLevel as CompressionLevel) || 'medium';

    if (file.size > maxSize) {
      throw budget.tooLarge(file.size);
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    compressed = await compressPdf({ pdfBuffer, level });
  } catch (error) {
    return handleConvertError(error, 'Failed to compress PDF.');
  }

  const { buffer: compressedPdfBuffer, originalSize, compressedSize } = compressed;

  const savedBytes = originalSize - compressedSize;
  const savedPercent = originalSize > 0 ? Math.max(0, Math.round((savedBytes / originalSize) * 100)) : 0;

  // Built before anything is recorded, so a response that cannot be built leaves no
  // history row behind.
  const response = new NextResponse(compressedPdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': attachmentDisposition(`compressed_${file.name || 'document.pdf'}`, 'compressed.pdf'),
      'X-Original-Size': String(originalSize),
      'X-Compressed-Size': String(compressedSize),
      'X-Saved-Percent': String(savedPercent),
    },
  });

  try {
    if (userId) {
      const originalFileName = ensureExtension(file?.name ? `compressed_${file.name}` : 'compressed.pdf', '.pdf');
      await saveConversionRecord(userId, 'Compress PDF', originalFileName, compressedPdfBuffer);
    }
  } catch (recordError) {
    console.error('Failed to record Compress PDF conversion:', recordError);
  }

  return response;
}
