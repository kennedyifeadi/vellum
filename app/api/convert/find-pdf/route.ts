import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';

// Use the legacy/CJS path for better node compatibility in serverless environments
// If this fails, we can use the regular import and handle the worker
// Using standard import but without worker for simple text extraction
pdfjs.GlobalWorkerOptions.workerSrc = false;

interface Match {
  page: number;
  text: string;
  snippet: string;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await Object.fromEntries(await req.formData());
    const file = formData.pdf as File;
    const searchTerm = (formData.searchTerm as string)?.toLowerCase();

    if (!file || !searchTerm) {
      return NextResponse.json({ error: 'Missing PDF file or search term' }, { status: 400 });
    }

    await dbConnect();
    const user = await User.findById(userId);
    const isPro = user?.plan === 'Pro';
    const maxPages = isPro ? 100 : 50;

    const arrayBuffer = await file.arrayBuffer();
    const pdfData = new Uint8Array(arrayBuffer);

    // Initial load for page count check
    const loadingTask = pdfjs.getDocument({ data: pdfData, useSystemFonts: true });
    const pdf = await loadingTask.promise;

    if (pdf.numPages > maxPages) {
      return NextResponse.json({ 
        error: `Your current plan allows searching up to ${maxPages} pages per document.` 
      }, { status: 400 });
    }

    const pdfLibDoc = await PDFDocument.load(arrayBuffer);
    const matches: Match[] = [];

    // Loop through pages
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pdfLibPage = pdfLibDoc.getPage(i - 1);

      textContent.items.forEach((itemOrMark) => {
        // Use a more specific type check to avoid 'any' if possible, or a safer cast
        const item = itemOrMark as { str?: string; transform?: number[]; width?: number; height?: number };
        if (!item.str) return;
        
        const text = item.str.toLowerCase();
        if (text.includes(searchTerm)) {
          // Find all occurrences in this item
          let index = text.indexOf(searchTerm);
          while (index !== -1) {
            // Collect metadata for Pro Users
            if (isPro) {
              const start = Math.max(0, index - 20);
              const end = Math.min(item.str.length, index + searchTerm.length + 20);
              const snippet = item.str.substring(start, end);
              matches.push({ page: i, text: item.str, snippet: `...${snippet}...` });
            }

            // Highlighting Logic
            // transform = [scaleX, skewY, skewX, scaleY, translateX, translateY]
            const [scaleX, , , scaleY, translateX, translateY] = item.transform;

            // In some PDFs, width/height aren't in item. Must calculate from transform or viewport
            const itemWidth = item.width || (item.str.length * scaleX * 0.6); // Fallback
            const itemHeight = item.height || scaleY;

            // Simple highlighting: Currently highlights the ENTIRE segment if matches.
            // Sophisticated matching (character-level) requires more complex math with char positions.
            // For V1, we highlight the segment containing the word.
            pdfLibPage.drawRectangle({
              x: translateX,
              y: translateY,
              width: itemWidth,
              height: itemHeight || 10,
              color: rgb(1, 1, 0), // Yellow
              opacity: 0.35,
            });

            index = text.indexOf(searchTerm, index + 1);
          }
        }
      });
    }

    const modifiedPdfBytes = await pdfLibDoc.save();
    const pdfBase64 = Buffer.from(modifiedPdfBytes).toString('base64');

    // Log Conversion
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await Conversion.create({
      userId,
      toolUsed: 'Find in PDF',
      fileName: file.name,
      fileSize: file.size,
      status: 'success',
      metadata: { pages: pdf.numPages, matchesFound: matches.length, searchTerm },
      expiresAt
    });

    return NextResponse.json({
      success: true,
      pdfBase64,
      matches: isPro ? matches : [],
      matchCount: matches.length
    });

  } catch (error) {
    console.error('[API/Convert/Find-PDF] Error:', error);
    return NextResponse.json({ error: 'Failed to search and highlight PDF' }, { status: 500 });
  }
}