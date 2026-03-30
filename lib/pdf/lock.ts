import { PDFDocument } from 'pdf-lib-plus-encrypt';

interface LockPdfOptions {
  pdfBuffer: Buffer;
  password: string;
}

export async function lockPdf({
  pdfBuffer,
  password,
}: LockPdfOptions): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);

  // Encrypt the PDF with the provided password
  // The pdf-lib-plus-encrypt fork requires calling encrypt() before save()
  await pdfDoc.encrypt({
    userPassword: password,
    ownerPassword: password, // Owner password can be different for more control
  });
  const encryptedPdfBytes = await pdfDoc.save();

  return Buffer.from(encryptedPdfBytes);
}