import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import { PDFParse } from 'pdf-parse';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { handleConvertError } from '@/lib/convert/errors';
import { ConvertiblePage, missingTextPlaceholder, toConvertiblePages } from '@/lib/convert/pdf-text';
import { assertLineCountWithinPlan, assertPageCountWithinPlan } from '@/lib/convert/pdf-to-docx-limits';

// The plan caps keep a permitted conversion to a few seconds; this is the backstop for
// an input that is slow in a way the caps do not measure. 60s is the longest duration
// every Vercel plan accepts.
export const maxDuration = 60;

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

async function extractPages(file: File, plan: string): Promise<ConvertiblePage[]> {
  const pdfParser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const { total } = await pdfParser.getInfo();
    assertPageCountWithinPlan(plan, total);

    const { pages } = await pdfParser.getText({ pageJoiner: '' });
    return toConvertiblePages(pages);
  } finally {
    await pdfParser.destroy();
  }
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

    const maxSize = resolvePlanLimit(plan, {
      guest: 25 * 1024 * 1024,
      Basic: 50 * 1024 * 1024,
      Pro: 100 * 1024 * 1024,
      Enterprise: 500 * 1024 * 1024,
    });

    if (file.size > maxSize) {
      return NextResponse.json({ 
        error: `Your current plan allows PDFs up to ${maxSize / (1024 * 1024)}MB.` 
      }, { status: 400 });
    }

    const pages = await extractPages(file, plan);
    assertLineCountWithinPlan(plan, countLines(pages));

    const doc = new Document({
      sections: [{
        properties: {},
        children: pages.flatMap(toParagraphs),
      }],
    });

    const docxBuffer = await Packer.toBuffer(doc);

    // Log Conversion
    if (userId) {
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // Expires in 2 hours
      await Conversion.create({
        userId,
        toolUsed: 'PDF to DOCX',
        fileName: file.name,
        fileSize: file.size,
        status: 'success',
        metadata: { pages: pages.length, processedSize: docxBuffer.length },
        expiresAt
      });
    }

    return new NextResponse(docxBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${file.name.replace(/\.[^/.]+$/, "")}.docx"`,
      },
    });

  } catch (error) {
    return handleConvertError(error, 'Failed to convert PDF to DOCX');
  }
}
