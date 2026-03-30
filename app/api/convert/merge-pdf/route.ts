import { NextRequest, NextResponse } from 'next/server';
import { mergePdfs } from '@/lib/pdf/merge';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('pdfs') as File[];

    if (!files || files.length < 2) {
      return NextResponse.json({ error: 'Please provide at least two PDF files to merge.' }, { status: 400 });
    }

    const pdfBuffers: Buffer[] = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      pdfBuffers.push(Buffer.from(arrayBuffer));
    }

    const mergedPdfBuffer = await mergePdfs({
      pdfBuffers,
    });

    const userId = await getAuthUserId(req);
    if (userId) {
      const originalFileName = files[0]?.name ? `merged_${files[0].name}` : 'merged.pdf';
      await saveConversionRecord(userId, 'Merge PDF', originalFileName, Buffer.from(mergedPdfBuffer));
    }

    return new NextResponse(mergedPdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="merged.pdf"',
      },
    });
  } catch (error) {
    console.error('Error merging PDFs:', error);
    return NextResponse.json({ error: 'Failed to merge PDFs.' }, { status: 500 });
  }
}