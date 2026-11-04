import { PDFDict, PDFDocument, PDFHeader, PDFName, PDFNumber } from 'pdf-lib-plus-encrypt';
import { ClientError } from '@/lib/convert/errors';
import { corruptPdfMessage, emptyPdfMessage } from '@/lib/pdf/loadPdf';
import { r6PasswordEntries } from '@/lib/pdf/aes256-r6';
import { lockPasswordBytes, validateLockPassword } from '@/lib/pdf/lock-password';

const AES256_HEADER_VERSION = '1.7ext3';

interface LockPdfOptions {
  pdfBuffer: Buffer;
  password: string;
}

function fileKeyBytes(pdfDoc: PDFDocument): Buffer {
  const key = pdfDoc._security!.encryptionKey;
  const bytes = Buffer.alloc(key.sigBytes);
  for (let i = 0; i < key.sigBytes; i++) {
    bytes[i] = (key.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return bytes;
}

// R5 checks a password with one unsalted-iteration SHA-256, which is weak against offline
// guessing, and pdf.js reads R5 passwords as single bytes, so it cannot open a file locked
// with a non-ASCII one. R6 differs only in how /U, /UE, /O and /OE are derived from the
// password: the random file key, /Perms and the AESV3 encryption of every object stay as
// the fork made them.
function upgradeToR6(pdfDoc: PDFDocument, password: Buffer): void {
  const { context } = pdfDoc;
  const encryptDict = context.lookup(context.trailerInfo.Encrypt, PDFDict);
  const entries = r6PasswordEntries(password, password, fileKeyBytes(pdfDoc));

  encryptDict.set(PDFName.of('R'), PDFNumber.of(6));
  for (const [key, value] of Object.entries(entries)) {
    encryptDict.set(PDFName.of(key), context.obj(value));
  }
}

// R6 is Adobe's extension level 8 to PDF 1.7 (and native to PDF 2.0). Declare it the
// way qpdf marks its own R6 output, so a reader knows which version the file needs.
function markForR6Readers(pdfDoc: PDFDocument): void {
  const { context, catalog } = pdfDoc;
  if (Number.parseFloat(context.header.getVersion()) < 1.7) {
    context.header = PDFHeader.forVersion(1, 7);
  }
  const extensions = catalog.lookupMaybe(PDFName.of('Extensions'), PDFDict) ?? context.obj({});
  extensions.set(PDFName.of('ADBE'), context.obj({ BaseVersion: '1.7', ExtensionLevel: 8 }));
  catalog.set(PDFName.of('Extensions'), extensions);
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
  // duration of encrypt() so every document is locked with AES-256 (V5) regardless
  // of the source header; upgradeToR6 then replaces the fork's R5 password entries.
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

  upgradeToR6(pdfDoc, Buffer.from(lockPasswordBytes(password)));
  markForR6Readers(pdfDoc);

  const encryptedPdfBytes = await pdfDoc.save();

  return Buffer.from(encryptedPdfBytes);
}
