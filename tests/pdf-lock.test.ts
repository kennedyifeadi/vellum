import { createHash } from 'crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { lockPdf } from '../lib/pdf/lock';

async function createPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 300]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: 150, font, size: 18 });
  }
  return Buffer.from(await doc.save());
}

// pdf-lib always emits a `%PDF-1.7` header; rewrite just that comment so we can
// exercise lockPdf with the range of source headers the fork would otherwise map
// to RC4-40 / RC4-128 / AES-128.
async function createPdfWithHeader(version: string): Promise<Buffer> {
  const bytes = await createPdf(1);
  const original = Buffer.from('%PDF-1.7');
  if (bytes.indexOf(original) !== 0) {
    throw new Error('unexpected pdf-lib header layout');
  }
  return Buffer.concat([Buffer.from(`%PDF-${version}`), bytes.subarray(original.length)]);
}

function encryptDict(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  const start = text.indexOf('/Filter /Standard');
  if (start === -1) {
    throw new Error('no standard security handler in output');
  }
  return text.slice(start, start + 700);
}

// Independent AES-256 / R5 password check (ISO 32000-1 Adobe extension level 3,
// Algorithm 2.A without the R6 iteration): the /U entry is
// SHA-256(password || validationSalt) || validationSalt || keySalt, so a password
// is correct iff it reproduces the first 32 bytes. This does not rely on the
// fork's own crypto beyond reading the stored salts.
function userPasswordMatches(pdf: Buffer, password: string): boolean {
  const dict = encryptDict(pdf);
  const u = dict.match(/\/U\s*<([0-9a-fA-F]+)>/);
  if (!u) {
    throw new Error('no /U entry in encryption dict');
  }
  const uBytes = Buffer.from(u[1], 'hex');
  const storedHash = uBytes.subarray(0, 32);
  const validationSalt = uBytes.subarray(32, 40);

  const normalized = unescape(encodeURIComponent(password.normalize('NFKC'))).slice(0, 127);
  const pwBytes = Buffer.from(normalized, 'latin1');

  const computed = createHash('sha256')
    .update(Buffer.concat([pwBytes, validationSalt]))
    .digest();
  return computed.equals(storedHash);
}

describe('lockPdf (lib/pdf/lock.ts)', () => {
  it('produces a PDF that cannot be opened without ignoring encryption', async () => {
    const pdfBuffer = await createPdf(2);

    const lockedBuffer = await lockPdf({ pdfBuffer, password: 'letmein' });

    await expect(PDFDocument.load(lockedBuffer)).rejects.toThrow(/is encrypted/i);
  });

  // Same root cause as compressPdf (see pdf-compress.test.ts): loading an already-encrypted
  // PDF with `ignoreEncryption: true` and then touching its page tree fails deep inside
  // pdf-lib with a confusing raw TypeError, because neither pdf-lib nor pdf-lib-plus-encrypt
  // can decrypt the object streams on load. lockPdf now checks `isEncrypted` up front and
  // fails fast with an actionable message instead of attempting to re-encrypt.
  it('throws a clear error instead of crashing when locking an already-locked PDF', async () => {
    const pdfBuffer = await createPdf(3);
    const lockedBuffer = await lockPdf({ pdfBuffer, password: 'letmein' });

    await expect(lockPdf({ pdfBuffer: lockedBuffer, password: 'newpassword' })).rejects.toThrow(
      /already password-protected/i
    );
  });

  it('rejects an empty password instead of producing an unprotected PDF', async () => {
    const pdfBuffer = await createPdf(1);

    await expect(lockPdf({ pdfBuffer, password: '' })).rejects.toThrow(/at least 4 characters/i);
  });

  it('rejects a password containing control characters', async () => {
    const pdfBuffer = await createPdf(1);

    await expect(lockPdf({ pdfBuffer, password: 'ab\x00cd' })).rejects.toThrow(/control characters/i);
  });

  it.each(['1.3', '1.5', '1.7'])(
    'emits an AES-256 (/V 5 /R 5 /AESV3) encryption dict for a %s source header',
    async (version) => {
      const pdfBuffer = await createPdfWithHeader(version);

      const locked = await lockPdf({ pdfBuffer, password: 'letmein' });
      const dict = encryptDict(locked);

      expect(dict).toMatch(/\/V 5(\D|$)/);
      expect(dict).toMatch(/\/R 5(\D|$)/);
      expect(dict).toMatch(/\/Length 256(\D|$)/);
      expect(dict).toMatch(/\/CFM\s*\/AESV3/);
    }
  );

  it('round-trips a password longer than 32 bytes without truncating it', async () => {
    const pdfBuffer = await createPdfWithHeader('1.3');
    const password = `${'A'.repeat(40)}YYYY`;

    const locked = await lockPdf({ pdfBuffer, password });

    expect(userPasswordMatches(locked, password)).toBe(true);
    expect(userPasswordMatches(locked, 'A'.repeat(32))).toBe(false);
    expect(userPasswordMatches(locked, `${'A'.repeat(40)}ZZZZ`)).toBe(false);
  });

  it('round-trips a non-ASCII password exactly', async () => {
    const pdfBuffer = await createPdfWithHeader('1.3');
    const password = 'pásswörd-Ω';

    const locked = await lockPdf({ pdfBuffer, password });

    expect(userPasswordMatches(locked, password)).toBe(true);
    expect(userPasswordMatches(locked, 'password')).toBe(false);
  });
});
