import { PDFDocument } from 'pdf-lib';
import { loadPdf } from '@/lib/pdf/loadPdf';

interface MergePdfOptions {
  pdfBuffers: Buffer[];
}

export async function mergePdfs({
  pdfBuffers,
}: MergePdfOptions): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();

  for (const [index, pdfBuffer] of pdfBuffers.entries()) {
    // Any one of the loop's files could be the bad input, so name it in the message.
    const pdf = await loadPdf(pdfBuffer, {
      label: `File ${index + 1}`,
      encryptedMessage: `File ${index + 1} is password-protected. Please remove the password before merging it.`,
    });

    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return Buffer.from(await mergedPdf.save());
}
