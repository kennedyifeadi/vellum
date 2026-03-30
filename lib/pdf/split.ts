import { PDFDocument } from 'pdf-lib';

interface SplitPdfOptions {
  pdfBuffer: Buffer;
  startPage?: number;
  endPage?: number;
  splitEvery?: boolean;
  outputFileNamePrefix: string;
}

export async function splitPdf({
  pdfBuffer,
  startPage = 1,
  endPage = 1,
  splitEvery = false,
  outputFileNamePrefix,
}: SplitPdfOptions): Promise<Map<string, Buffer>> {
  const originalPdf = await PDFDocument.load(pdfBuffer);
  const totalPages = originalPdf.getPageCount();
  const splitPdfs = new Map<string, Buffer>();

  if (!splitEvery) {
    // Extract specific range
    const newPdf = await PDFDocument.create();
    const actualStart = Math.max(0, startPage - 1);
    const actualEnd = Math.min(totalPages - 1, endPage - 1);
    
    // Make sure bounds are correctly ordered
    const minPage = Math.min(actualStart, actualEnd);
    const maxPage = Math.max(actualStart, actualEnd);
    
    // Generate indices from minPage to maxPage
    const indicesToCopy = Array.from({ length: maxPage - minPage + 1 }, (_, i) => minPage + i);
    
    const copiedPages = await newPdf.copyPages(originalPdf, indicesToCopy);
    copiedPages.forEach((page) => newPdf.addPage(page));
    
    splitPdfs.set(`${outputFileNamePrefix}_pages_${minPage + 1}_to_${maxPage + 1}.pdf`, Buffer.from(await newPdf.save()));
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