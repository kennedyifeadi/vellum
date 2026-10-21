import { NextRequest, NextResponse } from 'next/server';
import { mergePdfs } from '@/lib/pdf/merge';
import { resolveCaller } from '@/lib/auth/caller';
import { saveConversionRecord } from '@/lib/conversions';
import { ensureExtension } from '@/lib/paths';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { handleConvertError } from '@/lib/convert/errors';
import { readMultipartForm, uploadBudget } from '@/lib/http/read-upload';

export async function POST(req: NextRequest) {
  try {
    const { userId, plan } = await resolveCaller(req);

    const MAX_GUEST_SIZE = 25 * 1024 * 1024;
    const MAX_BASIC_SIZE = 50 * 1024 * 1024;
    const MAX_PRO_SIZE = 100 * 1024 * 1024;
    const MAX_ENTERPRISE_SIZE = 250 * 1024 * 1024;

    let maxSize = MAX_GUEST_SIZE;
    if (plan === 'Enterprise') maxSize = MAX_ENTERPRISE_SIZE;
    else if (plan === 'Pro') maxSize = MAX_PRO_SIZE;
    else if (plan === 'Basic') maxSize = MAX_BASIC_SIZE;
    const budget = uploadBudget(maxSize, `Your current plan allows merges totaling up to ${maxSize / (1024 * 1024)}MB.`);

    const formData = await readMultipartForm(req, budget);
    const files = await resolveFiles(formData, 'pdfs', budget);

    if (!files || files.length < 2) {
      return NextResponse.json({ error: 'Please provide at least two PDF files to merge.' }, { status: 400 });
    }

    const maxAllowed = resolvePlanLimit(plan, {
      guest: 3,
      Basic: 30,
      Pro: 50,
      Enterprise: 250,
    });

    if (files.length > maxAllowed) {
      return NextResponse.json({ 
        error: `Your current plan allows up to ${maxAllowed} files per merge.` 
      }, { status: 400 });
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxSize) {
      throw budget.tooLarge(totalSize);
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
      try {
        const originalFileName = ensureExtension(files[0]?.name ? `merged_${files[0].name}` : 'merged.pdf', '.pdf');
        await saveConversionRecord(userId, 'Merge PDF', originalFileName, Buffer.from(mergedPdfBuffer));
      } catch (recordError) {
        console.error('Failed to record Merge PDF conversion:', recordError);
      }
    }

    return new NextResponse(mergedPdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="merged.pdf"',
      },
    });
  } catch (error) {
    return handleConvertError(error, 'Failed to merge PDFs.');
  }
}