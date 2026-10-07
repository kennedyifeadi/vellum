import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { saveConversionRecord } from '@/lib/conversions';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import { extractPdfPages, PdfExtractionError } from '@/lib/convert/pdf-extraction';
import { ConvertiblePage, missingTextPlaceholder, toConvertiblePages } from '@/lib/convert/pdf-text';
import {
  assertFileSizeWithinPlan,
  assertLineCountWithinPlan,
  assertPageCountWithinPlan,
  CONVERTER_BUSY_MESSAGE,
  extractionOptionsForPlan,
  PDF_TOO_COMPLEX_MESSAGE,
} from '@/lib/convert/pdf-to-docx-limits';

// The extraction deadline (25s at most) and the DOCX build the page and line caps allow
// (about 2.5s at most) bound a request well inside this; it is the platform's own backstop
// and only takes effect on Vercel, where 60s is the longest duration every plan accepts.
export const maxDuration = 60;

const BUSY_RETRY_AFTER_SECONDS = 5;

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

function isBusy(error: unknown): boolean {
  return error instanceof PdfExtractionError && error.failure.reason === 'busy';
}

function countLines(pages: ConvertiblePage[]): number {
  return pages.reduce((lineCount, page) => lineCount + (page.hasText ? page.lines.length : 1), 0);
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);

    const formData = await req.formData();
    const file = (await resolveFiles(formData, 'pdf'))[0] as File;

    if (!file) {
      return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });
    }

    let plan = 'Free';
    if (userId) {
      await dbConnect();
      const user = await User.findById(userId);
      plan = user?.plan || 'Free';
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
      return NextResponse.json(
        { error: CONVERTER_BUSY_MESSAGE },
        { status: 503, headers: { 'Retry-After': String(BUSY_RETRY_AFTER_SECONDS) } },
      );
    }
    return handleConvertError(error, 'Failed to convert PDF to DOCX');
  }
}
