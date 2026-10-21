import { NextRequest, NextResponse } from 'next/server';
import { resolveCaller } from '@/lib/auth/caller';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { recordConversionHistory } from '@/lib/conversions';
import { PDFDocument, rgb } from 'pdf-lib';
import { corruptPdfMessage, emptyPdfMessage, encryptedPdfMessage } from '@/lib/pdf/loadPdf';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import { extractPdfTextItems, type PdfTextItem } from '@/lib/convert/find-pdf-extraction';
import {
  assertFileSizeWithinPlan,
  assertPageCountWithinPlan,
  extractionOptionsForPlan,
  FIND_PDF_BUSY_MESSAGE,
  PDF_TOO_COMPLEX_MESSAGE,
  uploadBudgetForPlan,
} from '@/lib/convert/find-pdf-limits';
import { isBusy, parserFailure, PdfExtractionError } from '@/lib/convert/pdf-worker';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import { findInItems } from '@/lib/pdf/findPdfStream';
import { readMultipartForm, textField } from '@/lib/http/read-upload';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

interface Match {
  page: number;
  text: string;
  snippet: string;
}

function rethrowExtractionFailure(error: unknown, plan: string): never {
  if (error instanceof PdfExtractionError) {
    const { failure } = error;
    if (failure.reason === 'page-limit') {
      assertPageCountWithinPlan(plan, failure.pageCount);
    }
    if (failure.reason === 'deadline' || failure.reason === 'memory') {
      throw new ClientError(PDF_TOO_COMPLEX_MESSAGE);
    }
    if (failure.reason === 'parser') {
      throw parserFailure(error);
    }
  }
  throw error;
}

async function extractTextItems(data: Uint8Array, plan: string): Promise<PdfTextItem[][]> {
  try {
    return await extractPdfTextItems(data, extractionOptionsForPlan(plan));
  } catch (error) {
    rethrowExtractionFailure(error, plan);
  }
}

// pdf.js has already read the PDF, but pdf-lib refuses some that pdf.js accepts: one
// with only an owner password (pdf.js opens it, pdf-lib cannot decrypt it), or one
// pdf.js could repair.
async function loadForHighlighting(data: ArrayBuffer): Promise<PDFDocument> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(data, { ignoreEncryption: true });
  } catch (error) {
    throw new ClientError(corruptPdfMessage(), 400, { cause: error });
  }
  if (pdfDoc.isEncrypted) {
    throw new ClientError(encryptedPdfMessage());
  }
  return pdfDoc;
}

export async function POST(req: NextRequest) {
  try {
    assertWithinRateLimit(req);

    const { userId, plan } = await resolveCaller(req);

    const budget = uploadBudgetForPlan(plan);
    const formData = await readMultipartForm(req, budget);
    const file = (await resolveFiles(formData, 'pdf', budget))[0] as File;
    const searchTerm = textField(formData, 'searchTerm')?.toLowerCase();

    if (!file || !searchTerm) {
      return NextResponse.json({ error: 'Missing PDF file or search term' }, { status: 400 });
    }

    const isPro = plan === 'Pro';

    assertFileSizeWithinPlan(plan, file.size);

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new ClientError(emptyPdfMessage());
    }
    // The extraction worker takes ownership of the bytes it is given, so it gets a copy
    // and pdf-lib keeps the original.
    const pageTextItems = await extractTextItems(new Uint8Array(arrayBuffer.slice(0)), plan);

    const pdfLibDoc = await loadForHighlighting(arrayBuffer);
    const matches: Match[] = [];
    let totalMatchCount = 0; // counted for ALL users, not just Pro

    // Loop through pages
    for (let i = 1; i <= pageTextItems.length; i++) {
      const textItems = pageTextItems[i - 1];
      const pdfLibPage = pdfLibDoc.getPage(i - 1);

      const { matches: pageMatches, matchCount } = findInItems(textItems, searchTerm);
      totalMatchCount += matchCount; // always count, regardless of plan

      if (isPro) {
        for (const match of pageMatches) {
          matches.push({ page: i, text: match.text, snippet: match.snippet });
        }
      }

      // Highlight every item a match overlaps, so a match spanning a line wrap gets a
      // highlight on each line it touches. Rectangle geometry (whole-run width, vertical
      // offset, rotated text) is out of scope here — tracked in #59.
      const itemsToHighlight = new Set<number>();
      for (const match of pageMatches) {
        for (const itemIndex of match.itemIndices) itemsToHighlight.add(itemIndex);
      }

      for (const itemIndex of itemsToHighlight) {
        const item = textItems[itemIndex];
        // transform = [scaleX, skewY, skewX, scaleY, translateX, translateY]
        const [scaleX, , , scaleY, translateX, translateY] = item.transform || [1, 0, 0, 1, 0, 0];
        const itemWidth = item.width || (item.str.length * scaleX * 0.6); // Fallback
        const itemHeight = item.height || scaleY;

        pdfLibPage.drawRectangle({
          x: translateX,
          y: translateY,
          width: itemWidth,
          height: itemHeight || 10,
          color: rgb(1, 1, 0), // Yellow
          opacity: 0.35,
        });
      }
    }

    const modifiedPdfBytes = await pdfLibDoc.save();
    const pdfBase64 = Buffer.from(modifiedPdfBytes).toString('base64');

    // Built before anything is recorded, so a response that cannot be built leaves no
    // history row behind.
    const response = NextResponse.json({
      success: true,
      pdfBase64,
      matches: isPro ? matches : [],
      matchCount: totalMatchCount
    });

    if (userId) {
      try {
        await recordConversionHistory(userId, 'Find in PDF', file.name, file.size, {
          pages: pageTextItems.length,
          matchesFound: totalMatchCount,
          searchTerm,
        });
      } catch (recordError) {
        console.error('Failed to record Find in PDF conversion:', recordError);
      }
    }

    return response;

  } catch (error) {
    if (isBusy(error)) {
      return busyResponse(FIND_PDF_BUSY_MESSAGE);
    }
    return handleConvertError(error, 'Failed to search and highlight PDF');
  }
}