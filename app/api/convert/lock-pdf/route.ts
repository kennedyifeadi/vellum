import { NextRequest, NextResponse } from 'next/server';
import { lockPdf, validateLockPassword } from '@/lib/pdf/lock';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';
import { ensureExtension } from '@/lib/paths';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = (await resolveFiles(formData, 'pdf'))[0] as File;
    const password = formData.get('password') as string;

    if (!file || !password) {
      return NextResponse.json({ error: 'PDF file and password are required.' }, { status: 400 });
    }

    const passwordError = validateLockPassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const userId = await getAuthUserId(req);
    let plan = 'Free';
    if (userId) {
      await dbConnect();
      const user = await User.findById(userId);
      plan = user?.plan || 'Free';
    }

    const maxSize = resolvePlanLimit(plan, {
      guest: 25 * 1024 * 1024,
      Basic: 50 * 1024 * 1024,
      Pro: 100 * 1024 * 1024,
      Enterprise: 500 * 1024 * 1024,
    });

    if (file.size > maxSize) {
      throw new ClientError(
        `Your current plan allows PDFs up to ${maxSize / (1024 * 1024)}MB.`,
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    const lockedPdfBuffer = await lockPdf({
      pdfBuffer,
      password,
    });

    if (userId) {
      try {
        const originalFileName = ensureExtension(file?.name ? `locked_${file.name}` : 'locked.pdf', '.pdf');
        await saveConversionRecord(userId, 'Lock PDF', originalFileName, Buffer.from(lockedPdfBuffer));
      } catch (recordError) {
        console.error('Failed to record Lock PDF conversion:', recordError);
      }
    }

    return new NextResponse(lockedPdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="locked.pdf"',
      },
    });
  } catch (error) {
    return handleConvertError(error, 'Failed to lock PDF.');
  }
}
