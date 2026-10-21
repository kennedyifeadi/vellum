import { NextRequest, NextResponse } from 'next/server';
import { splitPdf } from '@/lib/pdf/split';
import JSZip from 'jszip';
import { resolveCaller } from '@/lib/auth/caller';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { saveConversionRecord } from '@/lib/conversions';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { handleConvertError } from '@/lib/convert/errors';
import { readMultipartForm, uploadBudget } from '@/lib/http/read-upload';


export async function POST(req: NextRequest) {
  try {
    const { userId, plan } = await resolveCaller(req);

    const maxSize = resolvePlanLimit(plan, {
      guest: 25 * 1024 * 1024,
      Basic: 50 * 1024 * 1024,
      Pro: 100 * 1024 * 1024,
      Enterprise: 500 * 1024 * 1024,
    });
    const budget = uploadBudget(maxSize, `Your current plan allows PDFs up to ${maxSize / (1024 * 1024)}MB.`);

    const formData = await readMultipartForm(req, budget);
    const file = (await resolveFiles(formData, 'pdf'))[0] as File;
    const startPage = parseInt(formData.get('startPage') as string, 10) || 1;
    const endPage = parseInt(formData.get('endPage') as string, 10) || 1;
    const splitEvery = formData.get('splitEvery') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided.' }, { status: 400 });
    }

    if (file.size > maxSize) {
      throw budget.tooLarge(file.size);
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    const splitPdfBuffers = await splitPdf({
      pdfBuffer,
      startPage,
      endPage,
      splitEvery,
      outputFileNamePrefix: 'split_document',
    });

    // Return a single PDF or a zip of all split documents.
    if (splitPdfBuffers.size === 1) {
      const firstEntry = splitPdfBuffers.entries().next().value;
      if (!firstEntry) throw new Error('splitPdf returned an empty result set');
      const [fileName, buffer] = firstEntry;

      if (userId) {
        try {
          await saveConversionRecord(userId, 'Split PDF', fileName, Buffer.from(buffer));
        } catch (recordError) {
          console.error('Failed to record Split PDF conversion:', recordError);
        }
      }

      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    }

    if (splitPdfBuffers.size > 1) {
      const zip = new JSZip();

      for (const [fileName, buffer] of Array.from(splitPdfBuffers.entries())) {
        zip.file(fileName, buffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      if (userId) {
        try {
          const originalFileName = file?.name ? `split_${file.name.replace('.pdf', '')}.zip` : 'split_documents.zip';
          await saveConversionRecord(userId, 'Split PDF', originalFileName, Buffer.from(zipBuffer));
        } catch (recordError) {
          console.error('Failed to record Split PDF conversion:', recordError);
        }
      }

      return new NextResponse(zipBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="split_documents.zip"`,
        },
      });
    }

    throw new Error('splitPdf returned no documents');
  } catch (error) {
    return handleConvertError(error, 'Failed to split PDF.');
  }
}
