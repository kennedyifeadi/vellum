import { PDFDocument } from 'pdf-lib';

interface SplitPdfOptions {
  pdfBuffer: Buffer;
  pagesToSplit?: number[]; // e.g., [1, 3, 5] to split after these pages
  outputFileNamePrefix: string;
}

export async function splitPdf({
  pdfBuffer,
  pagesToSplit,
  outputFileNamePrefix,
}: SplitPdfOptions): Promise<Map<string, Buffer>> {
  const originalPdf = await PDFDocument.load(pdfBuffer);
  const totalPages = originalPdf.getPageCount();
  const splitPdfs = new Map<string, Buffer>();

  if (pagesToSplit && pagesToSplit.length > 0) {
    let startPage = 0;
    for (const pageNum of pagesToSplit) {
      if (pageNum > startPage && pageNum <= totalPages) {
        const newPdf = await PDFDocument.create();
        const pages = await newPdf.copyPages(originalPdf, Array.from({ length: pageNum - startPage }, (_, i) => startPage + i));
        pages.forEach((page) => newPdf.addPage(page));
        splitPdfs.set(`${outputFileNamePrefix}_pages_${startPage + 1}_to_${pageNum}.pdf`, Buffer.from(await newPdf.save()));
        startPage = pageNum;
      }
    }
    // Add remaining pages if any
    if (startPage < totalPages) {
      const newPdf = await PDFDocument.create();
      const pages = await newPdf.copyPages(originalPdf, Array.from({ length: totalPages - startPage }, (_, i) => startPage + i));
      pages.forEach((page) => newPdf.addPage(page));
      splitPdfs.set(`${outputFileNamePrefix}_pages_${startPage + 1}_to_${totalPages}.pdf`, Buffer.from(await newPdf.save()));
    }
  } else {
    // Split into individual pages
    for (let i = 0; i < totalPages; i++) {
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(originalPdf, [i]);
      newPdf.addPage(copiedPage);
      splitPdfs.set(`${outputFileNamePrefix}_page_${i + 1}.pdf`, Buffer.from(await newPdf.save()));
    }
  }

  return splitPdfs;
}