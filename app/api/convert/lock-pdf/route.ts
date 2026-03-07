import { NextRequest, NextResponse } from 'next/server';
import { lockPdf } from '@/lib/pdf/lock';

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