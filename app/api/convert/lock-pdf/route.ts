import { NextRequest, NextResponse } from 'next/server';
import { lockPdf, validateLockPassword } from '@/lib/pdf/lock';
import { resolveCaller } from '@/lib/auth/caller';
import { saveConversionRecord } from '@/lib/conversions';
import { ensureExtension } from '@/lib/paths';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { TOOL_LIMITS } from '@/lib/tool-limits';
import { handleConvertError } from '@/lib/convert/errors';
import { readMultipartForm, textField, uploadBudget } from '@/lib/http/read-upload';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

export async function POST(req: NextRequest) {
  try {
    assertWithinRateLimit(req);

    const { userId, plan } = await resolveCaller(req);

    const maxSize = resolvePlanLimit(plan, TOOL_LIMITS['lock-pdf'].maxBytes);
    const budget = uploadBudget(maxSize, `Your current plan allows PDFs up to ${maxSize / (1024 * 1024)}MB.`);

    const formData = await readMultipartForm(req, budget);
    const file = (await resolveFiles(formData, 'pdf', budget))[0] as File;
    const password = textField(formData, 'password');

    if (!file || !password) {
      return NextResponse.json({ error: 'PDF file and password are required.' }, { status: 400 });
    }

    const passwordError = validateLockPassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    if (file.size > maxSize) {
      throw budget.tooLarge(file.size);
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    const lockedPdfBuffer = await lockPdf({
      pdfBuffer,
      password,
    });

    // Built before anything is recorded, so a response that cannot be built leaves no
    // history row behind.
    const response = new NextResponse(lockedPdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="locked.pdf"',
      },
    });

    if (userId) {
      try {
        const originalFileName = ensureExtension(file?.name ? `locked_${file.name}` : 'locked.pdf', '.pdf');
        await saveConversionRecord(userId, 'Lock PDF', originalFileName, Buffer.from(lockedPdfBuffer));
      } catch (recordError) {
        console.error('Failed to record Lock PDF conversion:', recordError);
      }
    }

    return response;
  } catch (error) {
    return handleConvertError(error, 'Failed to lock PDF.');
  }
}
