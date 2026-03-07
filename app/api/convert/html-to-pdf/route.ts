import { NextRequest, NextResponse } from 'next/server';
import { convertHtmlToPdf } from '@/lib/html/to-pdf';

export async function POST(req: NextRequest) {
  try {
    const { htmlContent, url } = await req.json();

    if (!htmlContent && !url) {
      return NextResponse.json({ error: 'Either HTML content or a URL must be provided.' }, { status: 400 });
    }

    const pdfBuffer = await convertHtmlToPdf({
      htmlContent,
      url,
    });

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="converted_html.pdf"',
      },
    });
  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    return NextResponse.json({ error: 'Failed to convert HTML to PDF.' }, { status: 500 });
  }
}