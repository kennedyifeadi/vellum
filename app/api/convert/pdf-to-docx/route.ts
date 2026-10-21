import { NextRequest, NextResponse } from 'next/server';
import { resolveCaller } from '@/lib/auth/caller';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { saveConversionRecord } from '@/lib/conversions';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import { extractPdfPages, PdfExtractionError } from '@/lib/convert/pdf-extraction';
import { ConvertiblePage, missingTextPlaceholder, toConvertiblePages } from '@/lib/convert/pdf-text';
import { isBusy } from '@/lib/convert/pdf-worker';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import {
  assertFileSizeWithinPlan,
  assertLineCountWithinPlan,
  assertPageCountWithinPlan,
  CONVERTER_BUSY_MESSAGE,
  extractionOptionsForPlan,
  PDF_TOO_COMPLEX_MESSAGE,
  uploadBudgetForPlan,
} from '@/lib/convert/pdf-to-docx-limits';
import { readMultipartForm } from '@/lib/http/read-upload';

function toParagraphs(page: ConvertiblePage, pageIndex: number): Paragraph[] {
  const runs = page.hasText
    ? page.lines.map(line => new TextRun(line))
    : [new TextRun({ text: missingTextPlaceholder(page.num), italics: true })];

  return runs.map((run, lineIndex) =>
    new Paragraph({
      children: [run],
      pageBreakBefore: pageIndex > 0 && lineIndex === 0,
    })
  );
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
      throw error.cause;
    }
  }
  throw error;
}

async function extractPages(file: File, plan: string): Promise<ConvertiblePage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    const pages = await extractPdfPages(data, extractionOptionsForPlan(plan));
    return toConvertiblePages(pages);
  } catch (error) {
    rethrowExtractionFailure(error, plan);
  }
}

function countLines(pages: ConvertiblePage[]): number {
  return pages.reduce((lineCount, page) => lineCount + (page.hasText ? page.lines.length : 1), 0);
}

export async function POST(req: NextRequest) {
  try {
    const { userId, plan } = await resolveCaller(req);

    const formData = await readMultipartForm(req, uploadBudgetForPlan(plan));
    const file = (await resolveFiles(formData, 'pdf'))[0] as File;

    if (!file) {
      return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });
    }

    assertFileSizeWithinPlan(plan, file.size);

    const pages = await extractPages(file, plan);
    assertLineCountWithinPlan(plan, countLines(pages));

    const doc = new Document({
      sections: [{
        properties: {},
        children: pages.flatMap(toParagraphs),
      }],
    });

    const docxBuffer = await Packer.toBuffer(doc);
    const outputFileName = `${file.name.replace(/\.[^/.]+$/, "")}.docx`;

    if (userId) {
      try {
        await saveConversionRecord(userId, 'PDF to DOCX', outputFileName, docxBuffer, {
          pages: pages.length,
          processedSize: docxBuffer.length,
        });
      } catch (recordError) {
        console.error('Failed to record PDF to DOCX conversion:', recordError);
      }
    }

    return new NextResponse(docxBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${outputFileName}"`,
      },
    });

  } catch (error) {
    if (isBusy(error)) {
      return busyResponse(CONVERTER_BUSY_MESSAGE);
    }
    return handleConvertError(error, 'Failed to convert PDF to DOCX');
  }
}
