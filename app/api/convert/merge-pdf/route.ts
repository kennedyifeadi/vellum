import { NextRequest, NextResponse } from 'next/server';
import { mergePdfs } from '@/lib/pdf/merge';
import { resolveCaller } from '@/lib/auth/caller';
import { saveConversionRecord } from '@/lib/conversions';
import { ensureExtension } from '@/lib/paths';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { TOOL_LIMITS } from '@/lib/tool-limits';
import { handleConvertError } from '@/lib/convert/errors';
import { readMultipartForm, uploadBudget } from '@/lib/http/read-upload';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

export async function POST(req: NextRequest) {
  try {
    assertWithinRateLimit(req);

    const { userId, plan } = await resolveCaller(req);

    const maxSize = resolvePlanLimit(plan, TOOL_LIMITS['merge-pdf'].maxBytes);
    const budget = uploadBudget(maxSize, `Your current plan allows merges totaling up to ${maxSize / (1024 * 1024)}MB.`);

    const formData = await readMultipartForm(req, budget);
    const files = await resolveFiles(formData, 'pdfs', budget);

    if (!files || files.length < 2) {
      return NextResponse.json({ error: 'Please provide at least two PDF files to merge.' }, { status: 400 });
    }

    const maxAllowed = resolvePlanLimit(plan, TOOL_LIMITS['merge-pdf'].maxFiles);

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

    // Built before anything is recorded, so a response that cannot be built leaves no
    // history row behind.
    const response = new NextResponse(mergedPdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="merged.pdf"',
      },
    });

    if (userId) {
      try {
        const originalFileName = ensureExtension(files[0]?.name ? `merged_${files[0].name}` : 'merged.pdf', '.pdf');
        await saveConversionRecord(userId, 'Merge PDF', originalFileName, Buffer.from(mergedPdfBuffer));
      } catch (recordError) {
        console.error('Failed to record Merge PDF conversion:', recordError);
      }
    }

    return response;
  } catch (error) {
    return handleConvertError(error, 'Failed to merge PDFs.');
  }
}