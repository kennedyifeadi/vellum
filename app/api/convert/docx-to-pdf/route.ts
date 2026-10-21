import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { convertDocxToPdf } from '@/lib/doc/to-pdf';
import { resolveCaller } from '@/lib/auth/caller';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import { readMultipartForm, uploadBudget } from '@/lib/http/read-upload';
import { attachmentDisposition } from '@/lib/http/content-disposition';

// A malicious .docx can be a few KB on disk yet declare gigabytes of decompressed XML.
// Reject anything whose entries expand far beyond their upload size, or past an absolute
// ceiling, before mammoth ever parses it.
const MAX_DECOMPRESSION_RATIO = 100;

/**
 * Sum of the declared uncompressed sizes of every zip entry, read from the zip's
 * central directory without inflating any entry. `uncompressedSize` is not on JSZip's
 * public type but is populated on every loaded entry. The value is attacker-declared: a
 * zip that understates it passes this check, but JSZip then fails with a size mismatch
 * when mammoth inflates the entry, which `convertDocxToPdf` reports as an invalid DOCX.
 */
function declaredUncompressedSize(zip: JSZip): number {
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
    total += data?.uncompressedSize ?? 0;
  }
  return total;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, plan } = await resolveCaller(req);

    const maxSize = resolvePlanLimit(plan, {
      guest: 25 * 1024 * 1024,
      Basic: 50 * 1024 * 1024,
      Pro: 100 * 1024 * 1024,
      Enterprise: 500 * 1024 * 1024,
    });

    const budget = uploadBudget(maxSize, `Your current plan allows DOCX files up to ${maxSize / (1024 * 1024)}MB.`);

    const formData = await readMultipartForm(req, budget);
    const file = (await resolveFiles(formData, 'docx', budget))[0] as File;

    if (!file) {
      return NextResponse.json({ error: 'No DOCX file provided.' }, { status: 400 });
    }

    if (file.size > maxSize) {
      throw budget.tooLarge(file.size);
    }

    const arrayBuffer = await file.arrayBuffer();
    const docxBuffer = Buffer.from(arrayBuffer);

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(docxBuffer);
    } catch (error) {
      throw new ClientError('The file is not a valid DOCX document.', 400, { cause: error });
    }

    const uncompressed = declaredUncompressedSize(zip);
    if (
      uncompressed > maxSize * 3 ||
      uncompressed > docxBuffer.length * MAX_DECOMPRESSION_RATIO
    ) {
      throw new ClientError('This DOCX expands to too much content to process.');
    }

    const pdfBuffer = await convertDocxToPdf({ docxBuffer });

    // Built before anything is recorded, so a response that cannot be built leaves no
    // history row behind.
    const response = new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(`${file.name.replace(/\.[^/.]+$/, '')}.pdf`, 'converted.pdf'),
      },
    });

    if (userId) {
      try {
        const originalFileName = file.name.replace(/\.[^/.]+$/, '') + '.pdf';
        await saveConversionRecord(userId, 'DOCX to PDF', originalFileName, Buffer.from(pdfBuffer));
      } catch (recordError) {
        console.error('Failed to record DOCX to PDF conversion:', recordError);
      }
    }

    return response;
  } catch (error) {
    return handleConvertError(error, 'Failed to convert DOCX to PDF.');
  }
}
