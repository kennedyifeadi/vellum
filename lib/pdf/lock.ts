import { PDFDocument } from 'pdf-lib-plus-encrypt';

interface LockPdfOptions {
  pdfBuffer: Buffer;
  password: string;
}

export async function lockPdf({
  pdfBuffer,
  password,
}: LockPdfOptions): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

  // pdf-lib-plus-encrypt can write encryption but has no counterpart for decrypting
  // on load, so an already-encrypted document's object streams stay opaque. Walking
  // its page tree (as encrypt()/save() do) would otherwise fail with a confusing
  // TypeError, so fail fast with an actionable message instead.
  if (pdfDoc.isEncrypted) {
    throw new Error('This PDF is already password-protected. Please remove the existing password before adding a new one.');
  }

  // Encrypt the PDF with the provided password
  // The pdf-lib-plus-encrypt fork requires calling encrypt() before save()
  await pdfDoc.encrypt({
    userPassword: password,
    ownerPassword: password, // Owner password can be different for more control
  });
  const encryptedPdfBytes = await pdfDoc.save();

  return Buffer.from(encryptedPdfBytes);
}