import { NextRequest, NextResponse } from 'next/server';
import { convertImagesToPdf } from '@/lib/image/to-pdf';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = await resolveFiles(formData, 'images');

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No image files provided.' }, { status: 400 });
    }

    const userId = await getAuthUserId(req);
    await dbConnect();
    const user = userId ? await User.findById(userId) : null;
    const plan = user?.plan || 'Free';
    
    const MAX_GUEST_FILES = 3;
    const MAX_BASIC_FILES = 30;
    const MAX_PRO_FILES = 50;
    
    let maxAllowed = MAX_GUEST_FILES;
    if (plan === 'Pro') maxAllowed = MAX_PRO_FILES;
    else if (plan === 'Basic') maxAllowed = MAX_BASIC_FILES;

    if (files.length > maxAllowed) {
      return NextResponse.json({ 
        error: `Your current plan allows up to ${maxAllowed} files per conversion.` 
      }, { status: 400 });
    }

    const imageBuffers: Buffer[] = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      imageBuffers.push(Buffer.from(arrayBuffer));
    }

    const pdfBuffer = await convertImagesToPdf({
      imageBuffers,
    });

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