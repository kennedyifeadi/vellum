import { PDFDocument } from 'pdf-lib';

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
  const saveOptions: Record<string, string> = {
    userPassword: password,
    ownerPassword: password, // Owner password can be different for more control
  };
  const encryptedPdfBytes = await pdfDoc.save(saveOptions);

  return Buffer.from(encryptedPdfBytes);
}