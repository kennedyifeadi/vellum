import { NextRequest, NextResponse } from 'next/server';
import { mergePdfs } from '@/lib/pdf/merge';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = await resolveFiles(formData, 'pdfs');

    if (!files || files.length < 2) {
      return NextResponse.json({ error: 'Please provide at least two PDF files to merge.' }, { status: 400 });
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
        error: `Your current plan allows up to ${maxAllowed} files per merge.` 
      }, { status: 400 });
    }

    const MAX_GUEST_SIZE = 25 * 1024 * 1024;
    const MAX_BASIC_SIZE = 50 * 1024 * 1024;
    const MAX_PRO_SIZE = 100 * 1024 * 1024;
    const MAX_ENTERPRISE_SIZE = 250 * 1024 * 1024;

    let maxSize = MAX_GUEST_SIZE;
    if (plan === 'Enterprise') maxSize = MAX_ENTERPRISE_SIZE;
    else if (plan === 'Pro') maxSize = MAX_PRO_SIZE;
    else if (plan === 'Basic') maxSize = MAX_BASIC_SIZE;

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxSize) {
      return NextResponse.json({
        error: `Your current plan allows merges totaling up to ${maxSize / (1024 * 1024)}MB.`
      }, { status: 400 });
    }

    const pdfBuffers: Buffer[] = [];
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      pdfBuffers.push(Buffer.from(arrayBuffer));
    }

    const mergedPdfBuffer = await mergePdfs({
      pdfBuffers,
    });

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