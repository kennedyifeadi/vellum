import { NextRequest, NextResponse } from 'next/server';
import { convertImagesToPdf } from '@/lib/image/to-pdf';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('images') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No image files provided.' }, { status: 400 });
    }

    const imageBuffers: Buffer[] = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      imageBuffers.push(Buffer.from(arrayBuffer));
    }

    const pdfBuffer = await convertImagesToPdf({
      imageBuffers,
    });

    const userId = await getAuthUserId(req);
    if (userId) {
      const originalFileName = files[0]?.name ? `${files[0].name.split('.')[0]}.pdf` : 'converted_images.pdf';
      await saveConversionRecord(userId, 'Image to PDF', originalFileName, Buffer.from(pdfBuffer));
    }

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="converted_images.pdf"',
      },
    });
  } catch (error) {
    console.error('Error converting images to PDF:', error);
    return NextResponse.json({ error: 'Failed to convert images to PDF.' }, { status: 500 });
  }
}