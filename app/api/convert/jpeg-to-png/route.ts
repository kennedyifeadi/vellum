import { NextRequest, NextResponse } from 'next/server';
import { convertJpegToPng } from '@/lib/image/to-png';
import { handleConvertError } from '@/lib/convert/errors';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File;

    if (!file) {
      return NextResponse.json({ error: 'No JPEG image file provided.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const jpegBuffer = Buffer.from(arrayBuffer);

    const pngBuffer = await convertJpegToPng({
      jpegBuffer,
    });

    return new NextResponse(pngBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'attachment; filename="converted_image.png"',
      },
    });
  } catch (error) {
    return handleConvertError(error, 'Failed to convert JPEG to PNG.');
  }
}
