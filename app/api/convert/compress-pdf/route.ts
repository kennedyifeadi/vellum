import { NextRequest, NextResponse } from 'next/server';
import { compressPdf } from '@/lib/pdf/compress';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('pdf') as File;
    const level = (formData.get('level') as 'low' | 'medium' | 'high') || 'medium';

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    const { buffer: compressedPdfBuffer, originalSize, compressedSize } = await compressPdf({
      pdfBuffer,
      level,
    });

    const userId = await getAuthUserId(req);
    if (userId) {
      const originalFileName = file?.name ? `compressed_${file.name}` : 'compressed.pdf';
      await saveConversionRecord(userId, 'Compress PDF', originalFileName, compressedPdfBuffer);
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
  } catch (error) {
    console.error('Error compressing PDF:', error);
    return NextResponse.json({ error: 'Failed to compress PDF.' }, { status: 500 });
  }
}
