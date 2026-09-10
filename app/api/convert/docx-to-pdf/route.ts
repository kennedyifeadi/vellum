import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { convertDocxToPdf } from '@/lib/doc/to-pdf';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';

// A malicious .docx can be a few KB on disk yet declare gigabytes of decompressed XML.
// Reject anything whose entries expand far beyond their upload size, or past an absolute
// ceiling, before mammoth ever parses it.
const MAX_DECOMPRESSION_RATIO = 100;

/**
 * Sum of the declared uncompressed sizes of every zip entry, read from the zip's
 * central directory without inflating any entry. `uncompressedSize` is not on JSZip's
 * public type but is populated on every loaded entry; a bomb that also lies about it
 * still hits the render deadline in `convertDocxToPdf`.
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

    const formData = await req.formData();
    const file = (await resolveFiles(formData, 'docx'))[0] as File;

    if (!file) {
      return NextResponse.json({ error: 'No DOCX file provided.' }, { status: 400 });
    }

    if (file.size > maxSize) {
      throw new ClientError(
        `Your current plan allows DOCX files up to ${maxSize / (1024 * 1024)}MB.`,
      );
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

    if (userId) {
      try {
        const originalFileName = file.name.replace(/\.[^/.]+$/, '') + '.pdf';
        await saveConversionRecord(userId, 'DOCX to PDF', originalFileName, Buffer.from(pdfBuffer));
      } catch (recordError) {
        console.error('Failed to record DOCX to PDF conversion:', recordError);
      }
    }

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${file.name.replace(/\.[^/.]+$/, '')}.pdf"`,
      },
    });
  } catch (error) {
    return handleConvertError(error, 'Failed to convert DOCX to PDF.');
  }
}
