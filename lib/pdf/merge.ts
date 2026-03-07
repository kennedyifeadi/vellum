import { PDFDocument } from 'pdf-lib';

interface MergePdfOptions {
  pdfBuffers: Buffer[];
}

export async function mergePdfs({
  pdfBuffers,
}: MergePdfOptions): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();

  for (const pdfBuffer of pdfBuffers) {
    const pdf = await PDFDocument.load(pdfBuffer);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return Buffer.from(await mergedPdf.save());
}