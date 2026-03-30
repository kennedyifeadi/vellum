import { NextRequest, NextResponse } from 'next/server';
import { splitPdf } from '@/lib/pdf/split';
import JSZip from 'jszip';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('pdf') as File;
    const startPage = parseInt(formData.get('startPage') as string, 10) || 1;
    const endPage = parseInt(formData.get('endPage') as string, 10) || 1;
    const splitEvery = formData.get('splitEvery') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided.' }, { status: 400 });
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

    const userId = await getAuthUserId(req);

    // Return a single PDF or a zip of all split documents.
    if (splitPdfBuffers.size === 1) {
      const firstEntry = splitPdfBuffers.entries().next().value;
      if (!firstEntry) return NextResponse.json({ error: 'Failed' }, { status: 500 });
      const [fileName, buffer] = firstEntry;

      if (userId) {
        await saveConversionRecord(userId, 'Split PDF', fileName, Buffer.from(buffer));
      }

      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    } else if (splitPdfBuffers.size > 1) {
      const zip = new JSZip();
      
      for (const [fileName, buffer] of Array.from(splitPdfBuffers.entries())) {
        zip.file(fileName, buffer);
      }
      
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      
      if (userId) {
        const originalFileName = file?.name ? `split_${file.name.replace('.pdf', '')}.zip` : 'split_documents.zip';
        await saveConversionRecord(userId, 'Split PDF', originalFileName, Buffer.from(zipBuffer));
      }
      
      return new NextResponse(zipBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="split_documents.zip"`,
        },
      });
    }

    return NextResponse.json({ error: 'Failed to split PDF.' }, { status: 500 });
  } catch (error) {
    console.error('Error splitting PDF:', error);
    return NextResponse.json({ error: 'Failed to split PDF.' }, { status: 500 });
  }
}