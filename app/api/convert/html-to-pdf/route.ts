import { NextRequest, NextResponse } from 'next/server';
import { convertHtmlToPdf } from '@/lib/html/to-pdf';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';

export async function POST(req: NextRequest) {
  try {
    let htmlContent: string | undefined;
    let url: string | undefined;
    let outputFileName = 'converted.pdf';

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // File upload mode
      const formData = await req.formData();
      const file = formData.get('html') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No HTML file provided.' }, { status: 400 });
      }
      htmlContent = await file.text();
      outputFileName = file.name.replace(/\.html?$/i, '.pdf');
    } else {
      // URL mode
      const body = await req.json();
      url = body.url;
      if (!url) {
        return NextResponse.json({ error: 'No URL provided.' }, { status: 400 });
      }
      try {
        const hostname = new URL(url).hostname;
        outputFileName = `${hostname}.pdf`;
      } catch {
        outputFileName = 'webpage.pdf';
      }
    }

    const pdfBuffer = await convertHtmlToPdf({ htmlContent, url });

    const userId = await getAuthUserId(req);
    if (userId) {
      await saveConversionRecord(userId, 'HTML to PDF', outputFileName, Buffer.from(pdfBuffer));
    }

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${outputFileName}"`,
      },
    });
  } catch (error) {
    console.error('Error converting HTML to PDF:', error);
    const message = error instanceof Error ? error.message : 'Failed to convert HTML to PDF.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}