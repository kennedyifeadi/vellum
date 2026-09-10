import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { findInItems, type TextItemLike } from '@/lib/pdf/findPdfStream';


interface Match {
  page: number;
  text: string;
  snippet: string;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);

    const formData = await req.formData();
    const file = (await resolveFiles(formData, 'pdf'))[0] as File;
    const searchTerm = (formData.get('searchTerm') as string)?.toLowerCase();

    if (!file || !searchTerm) {
      return NextResponse.json({ error: 'Missing PDF file or search term' }, { status: 400 });
    }

    await dbConnect();
    const user = userId ? await User.findById(userId) : null;
    const plan = user?.plan || 'Free';
    const isPro = plan === 'Pro';
    
    const maxPages = resolvePlanLimit(plan, {
      guest: 10,
      Basic: 50,
      Pro: 100,
      Enterprise: 500,
    });

    const arrayBuffer = await file.arrayBuffer();
    // Slice a copy for each consumer — pdfjs.getDocument() detaches/transfers the
    // underlying ArrayBuffer, so pdf-lib must have its own independent copy.
    const pdfjsData = new Uint8Array(arrayBuffer.slice(0));
    const pdfLibData = arrayBuffer.slice(0);

    // Initial load for page count check
    const loadingTask = pdfjs.getDocument({ data: pdfjsData, useSystemFonts: true });
    const pdf = await loadingTask.promise;

    if (pdf.numPages > maxPages) {
      return NextResponse.json({ 
        error: `Your current plan allows searching up to ${maxPages} pages per document.` 
      }, { status: 400 });
    }

    const pdfLibDoc = await PDFDocument.load(pdfLibData);
    const matches: Match[] = [];
    let totalMatchCount = 0; // counted for ALL users, not just Pro

    // Loop through pages
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pdfLibPage = pdfLibDoc.getPage(i - 1);

      // pdfjs yields TextItem | TextMarkedContent; only the former carries `str`.
      const textItems = textContent.items.filter(
        (itemOrMark) => typeof (itemOrMark as { str?: unknown }).str === 'string',
      ) as unknown as TextItemLike[];

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

    // Log Conversion
    if (userId) {
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await Conversion.create({
        userId,
        toolUsed: 'Find in PDF',
        fileName: file.name,
        fileSize: file.size,
        status: 'success',
        metadata: { pages: pdf.numPages, matchesFound: totalMatchCount, searchTerm },
        expiresAt
      });
    }

    return NextResponse.json({
      success: true,
      pdfBase64,
      matches: isPro ? matches : [],
      matchCount: totalMatchCount
    });

  } catch (error) {
    console.error('[API/Convert/Find-PDF] Error:', error);
    return NextResponse.json({ error: 'Failed to search and highlight PDF' }, { status: 500 });
  }
}