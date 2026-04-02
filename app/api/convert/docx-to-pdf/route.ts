import { NextRequest, NextResponse } from 'next/server';
import { convertDocxToPdf } from '@/lib/doc/to-pdf';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('docx') as File;

    if (!file) {
      return NextResponse.json({ error: 'No DOCX file provided.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const docxBuffer = Buffer.from(arrayBuffer);

    const pdfBuffer = await convertDocxToPdf({
      docxBuffer,
    });

    const userId = await getAuthUserId(req);
    if (userId) {
      const originalFileName = file.name.replace(/\.[^/.]+$/, "") + ".pdf";
      await saveConversionRecord(userId, 'DOCX to PDF', originalFileName, Buffer.from(pdfBuffer));
    }

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.name.replace(/\.[^/.]+$/, "")}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error converting DOCX to PDF:', error);
    return NextResponse.json({ error: 'Failed to convert DOCX to PDF.' }, { status: 500 });
  }
}