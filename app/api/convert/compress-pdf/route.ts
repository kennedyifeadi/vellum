import { NextRequest, NextResponse } from 'next/server';
import { compressPdf } from '@/lib/pdf/compress';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { handleConvertError } from '@/lib/convert/errors';

export async function POST(req: NextRequest) {
  let file: File | undefined;
  let compressed;

  try {
    const formData = await req.formData();
    file = (await resolveFiles(formData, 'pdf'))[0] as File;
    const level = formData.get('level') as 'low' | 'medium' | 'high' || 'medium';

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided.' }, { status: 400 });
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    compressed = await compressPdf({ pdfBuffer, level });
  } catch (error) {
    return handleConvertError(error, 'Failed to compress PDF.');
  }

  const { buffer: compressedPdfBuffer, originalSize, compressedSize } = compressed;

  try {
    const userId = await getAuthUserId(req);
    if (userId) {
      const originalFileName = file?.name ? `compressed_${file.name}` : 'compressed.pdf';
      await saveConversionRecord(userId, 'Compress PDF', originalFileName, compressedPdfBuffer);
    }
  } catch (recordError) {
    console.error('Failed to record Compress PDF conversion:', recordError);
  }

  const savedBytes = originalSize - compressedSize;
  const savedPercent = originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

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
