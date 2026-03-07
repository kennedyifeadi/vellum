import { NextRequest, NextResponse } from 'next/server';
import { convertDocxToPdf } from '@/lib/doc/to-pdf';

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

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="converted_document.pdf"',
      },
    });
  } catch (error) {
    console.error('Error converting DOCX to PDF:', error);
    return NextResponse.json({ error: 'Failed to convert DOCX to PDF.' }, { status: 500 });
  }
}