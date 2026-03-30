import { NextRequest, NextResponse } from 'next/server';
import { lockPdf } from '@/lib/pdf/lock';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('pdf') as File;
    const password = formData.get('password') as string;

    if (!file || !password) {
      return NextResponse.json({ error: 'PDF file and password are required.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    const lockedPdfBuffer = await lockPdf({
      pdfBuffer,
      password,
    });

    const userId = await getAuthUserId(req);
    if (userId) {
      const originalFileName = file?.name ? `locked_${file.name}` : 'locked.pdf';
      await saveConversionRecord(userId, 'Lock PDF', originalFileName, Buffer.from(lockedPdfBuffer));
    }

    return new NextResponse(lockedPdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="locked.pdf"',
      },
    });
  } catch (error) {
    console.error('Error locking PDF:', error);
    return NextResponse.json({ error: 'Failed to lock PDF.' }, { status: 500 });
  }
}