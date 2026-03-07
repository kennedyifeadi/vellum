import { NextRequest, NextResponse } from 'next/server';
import { splitPdf } from '@/lib/pdf/split';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('pdf') as File;
    const pagesToSplitStr = formData.get('pagesToSplit') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    let pagesToSplit: number[] | undefined;
    if (pagesToSplitStr) {
      pagesToSplit = pagesToSplitStr.split(',').map(Number).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);
    }

    const splitPdfBuffers = await splitPdf({
      pdfBuffer,
      pagesToSplit,
      outputFileNamePrefix: 'split_document',
    });

    // For simplicity, we'll return the first split PDF or a zip of all. 
    // A more robust solution would involve zipping all files or providing download links.
    if (splitPdfBuffers.size === 1) {
      const firstEntry = splitPdfBuffers.entries().next().value;
      if (!firstEntry) return NextResponse.json({ error: 'Failed' }, { status: 500 });
      const [fileName, buffer] = firstEntry;
      return new NextResponse(buffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    } else if (splitPdfBuffers.size > 1) {
      // This part would require a zipping library like 'archiver'
      // For now, let's just indicate multiple files were generated.
      return NextResponse.json({ message: `Successfully split PDF into ${splitPdfBuffers.size} files. Further implementation needed for multi-file download.` }, { status: 200 });
    }

    return NextResponse.json({ error: 'Failed to split PDF.' }, { status: 500 });
  } catch (error) {
    console.error('Error splitting PDF:', error);
    return NextResponse.json({ error: 'Failed to split PDF.' }, { status: 500 });
  }
}