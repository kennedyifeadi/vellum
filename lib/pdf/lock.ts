import { PDFDocument } from 'pdf-lib-plus-encrypt';
import { ClientError } from '@/lib/convert/errors';
import { corruptPdfMessage, emptyPdfMessage } from '@/lib/pdf/loadPdf';
import { validateLockPassword } from '@/lib/pdf/lock-password';

const AES256_HEADER_VERSION = '1.7ext3';

interface LockPdfOptions {
  pdfBuffer: Buffer;
  password: string;
}

export async function lockPdf({
  pdfBuffer,
  password,
}: LockPdfOptions): Promise<Buffer> {
  const validationError = validateLockPassword(password);
  if (validationError) {
    throw new ClientError(validationError);
  }
  if (pdfBuffer.length === 0) {
    throw new ClientError(emptyPdfMessage());
  }

  // pdf-lib-plus-encrypt's own PDFDocument, which loadPdf (plain pdf-lib) cannot return.
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  } catch (error) {
    throw new ClientError(corruptPdfMessage(), 400, { cause: error });
  }

  // pdf-lib-plus-encrypt can write encryption but has no counterpart for decrypting
  // on load, so an already-encrypted document's object streams stay opaque. Walking
  // its page tree (as encrypt()/save() do) would otherwise fail with a confusing
  // TypeError, so fail fast with an actionable message instead.
  if (pdfDoc.isEncrypted) {
    throw new ClientError('This PDF is already password-protected. Please remove the existing password before adding a new one.');
  }

  // pdf-lib loads a file with no document catalog (a bare `%PDF` header) without
  // complaint; it only fails once the page tree is walked.
  try {
    pdfDoc.getPageCount();
  } catch (error) {
    throw new ClientError(corruptPdfMessage(), 400, { cause: error });
  }

  // encrypt() in this fork ignores any caller-supplied pdfVersion and derives the
  // scheme from context.header.getVersion(): <=1.3 -> RC4-40, 1.4/1.5 -> RC4-128,
  // 1.6/1.7 -> AES-128, and only '1.7ext3' -> AES-256. Pin getVersion() for the
  // duration of encrypt() so every document is locked with AES-256 (V5/R5)
  // regardless of the source header. This also routes password handling through
  // processPasswordR5 (127-byte, NFKC-normalised) instead of the 32-byte,
  // Latin-1-only processPasswordR2R3R4.
  const { header } = pdfDoc.context;
  const originalGetVersion = header.getVersion;
  header.getVersion = () => AES256_HEADER_VERSION;

  try {
    await pdfDoc.encrypt({
      userPassword: password,
      ownerPassword: password,
    });
  } finally {
    header.getVersion = originalGetVersion;
  }

  const encryptedPdfBytes = await pdfDoc.save();

  return Buffer.from(encryptedPdfBytes);
}
