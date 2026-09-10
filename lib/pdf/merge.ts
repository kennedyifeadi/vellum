import { PDFDocument } from 'pdf-lib';

interface MergePdfOptions {
  pdfBuffers: Buffer[];
}

export async function mergePdfs({
  pdfBuffers,
}: MergePdfOptions): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();

  for (const [index, pdfBuffer] of pdfBuffers.entries()) {
    const pdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

    // `ignoreEncryption` only skips pdf-lib's load-time guard; it never decrypts the
    // object streams, so copyPages would later fail deep inside pdf-lib. Fail fast with
    // an actionable message, naming which input caused it since any one of the loop's
    // files could be the encrypted one.
    if (pdf.isEncrypted) {
      throw new Error(
        `File ${index + 1} is password-protected. Please remove the password before merging it.`
      );
    }

    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return Buffer.from(await mergedPdf.save());
}
