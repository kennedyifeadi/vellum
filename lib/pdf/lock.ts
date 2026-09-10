import { PDFDocument } from 'pdf-lib-plus-encrypt';

const AES256_HEADER_VERSION = '1.7ext3';
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 127;

interface LockPdfOptions {
  pdfBuffer: Buffer;
  password: string;
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

// AES-256/R5 hashes up to 127 bytes of the NFKC-normalised password, so anything
// longer is silently ignored. Control characters (including NUL) have no portable
// encoding in the password string and produce files a spec-compliant reader
// cannot reopen, so they are rejected rather than encrypted.
export function validateLockPassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (hasControlCharacter(password)) {
    return 'Password must not contain control characters.';
  }
  return null;
}

export async function lockPdf({
  pdfBuffer,
  password,
}: LockPdfOptions): Promise<Buffer> {
  const validationError = validateLockPassword(password);
  if (validationError) {
    throw new Error(validationError);
  }

  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

  // pdf-lib-plus-encrypt can write encryption but has no counterpart for decrypting
  // on load, so an already-encrypted document's object streams stay opaque. Walking
  // its page tree (as encrypt()/save() do) would otherwise fail with a confusing
  // TypeError, so fail fast with an actionable message instead.
  if (pdfDoc.isEncrypted) {
    throw new Error('This PDF is already password-protected. Please remove the existing password before adding a new one.');
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
