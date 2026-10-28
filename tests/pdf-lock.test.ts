import { createDecipheriv } from 'crypto';
import { inflateSync } from 'zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { hashR6Password } from '../lib/pdf/aes256-r6';
import { lockPdf } from '../lib/pdf/lock';
import { openPdfWithPassword } from './helpers/openPdfWithPassword';

// Each pdf.js check starts a Node process, which is slow on a loaded machine.
jest.setTimeout(60_000);

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
async function createPdfWithHeader(version: string, pageCount = 1): Promise<Buffer> {
  const bytes = await createPdf(pageCount);
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

// The catalog is written inside an encrypted object stream, so read it the way a reader
// would: unwrap the file key from /UE, then decrypt and inflate every /ObjStm.
function decryptedObjectStreams(pdf: Buffer, password: string): string {
  const dict = encryptDict(pdf);
  const entry = (name: string) => Buffer.from(dict.match(new RegExp(`/${name}\\s*<([0-9a-fA-F]+)>`))![1], 'hex');
  const u = entry('U');
  const passwordBytes = Buffer.from(password, 'utf8');
  const unwrap = createDecipheriv('aes-256-cbc', hashR6Password(passwordBytes, u.subarray(40, 48)), Buffer.alloc(16));
  const fileKey = Buffer.concat([unwrap.setAutoPadding(false).update(entry('UE')), unwrap.final()]);

  const text = pdf.toString('latin1');
  const decoded: string[] = [];
  for (const match of text.matchAll(/\/Type \/ObjStm[\s\S]*?\/Length (\d+)\s*>>\s*stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const data = pdf.subarray(start, start + Number(match[1]));
    const decipher = createDecipheriv('aes-256-cbc', fileKey, data.subarray(0, 16));
    decoded.push(inflateSync(Buffer.concat([decipher.update(data.subarray(16)), decipher.final()])).toString('latin1'));
  }
  return decoded.join('\n');
}

async function opensWith(pdf: Buffer, password: string): Promise<boolean> {
  const result = await openPdfWithPassword(pdf, password);
  if ('error' in result && result.error !== 'PasswordException') {
    throw new Error(`pdf.js failed for a reason other than the password: ${result.error}`);
  }
  return 'pageTexts' in result;
}

describe('lockPdf (lib/pdf/lock.ts)', () => {
  it('produces a PDF that cannot be opened without ignoring encryption', async () => {
    const pdfBuffer = await createPdf(2);

    const lockedBuffer = await lockPdf({ pdfBuffer, password: 'letmein!' });

    await expect(PDFDocument.load(lockedBuffer)).rejects.toThrow(/is encrypted/i);
  });

  // Same root cause as compressPdf (see pdf-compress.test.ts): loading an already-encrypted
  // PDF with `ignoreEncryption: true` and then touching its page tree fails deep inside
  // pdf-lib with a confusing raw TypeError, because neither pdf-lib nor pdf-lib-plus-encrypt
  // can decrypt the object streams on load. lockPdf now checks `isEncrypted` up front and
  // fails fast with an actionable message instead of attempting to re-encrypt.
  it('throws a clear error instead of crashing when locking an already-locked PDF', async () => {
    const pdfBuffer = await createPdf(3);
    const lockedBuffer = await lockPdf({ pdfBuffer, password: 'letmein!' });

    await expect(lockPdf({ pdfBuffer: lockedBuffer, password: 'newpassword' })).rejects.toThrow(
      /already password-protected/i
    );
  });

  it.each([
    ['an empty password', ''],
    ['6 characters', 'abcdef'],
    ['7 characters', 'abcdefg'],
    ['7 emoji', '\u{1F600}'.repeat(7)],
  ])('refuses %s', async (_label, password) => {
    const pdfBuffer = await createPdf(1);

    await expect(lockPdf({ pdfBuffer, password })).rejects.toThrow('Password must be at least 8 characters.');
  });

  it.each([
    ['8 ASCII characters', 'abcdefgh'],
    ['8 emoji', '\u{1F600}'.repeat(8)],
  ])('accepts %s, and pdf.js opens the file with exactly that password', async (_label, password) => {
    const pdfBuffer = await createPdf(1);

    const locked = await lockPdf({ pdfBuffer, password });

    expect(await opensWith(locked, password)).toBe(true);
    expect(await opensWith(locked, [...password].slice(0, -1).join(''))).toBe(false);
  });

  it('rejects a password containing control characters', async () => {
    const pdfBuffer = await createPdf(1);

    await expect(lockPdf({ pdfBuffer, password: 'abcd\x00efgh' })).rejects.toThrow(/control characters/i);
  });

  // AES-256 only hashes the first 127 UTF-8 bytes, so the limit is in bytes, not characters.
  it('accepts a password of exactly 127 bytes', async () => {
    const pdfBuffer = await createPdf(1);
    const password = 'A'.repeat(127);

    const locked = await lockPdf({ pdfBuffer, password });

    expect(await opensWith(locked, password)).toBe(true);
    expect(await opensWith(locked, `${'A'.repeat(126)}B`)).toBe(false);
  });

  it.each([
    ['128 ASCII bytes', 'A'.repeat(128)],
    ['a 70-character Cyrillic password (140 bytes)', 'Ж'.repeat(70)],
    ['a 67-character password of 131 bytes', `${'Ж'.repeat(64)}AAA`],
    ['input that NFKC-expands past the limit', 'ﷺ'.repeat(8)],
  ])('rejects %s', async (_label, password) => {
    const pdfBuffer = await createPdf(1);

    await expect(lockPdf({ pdfBuffer, password })).rejects.toThrow(/at most 127 bytes/i);
  });

  it.each(['1.3', '1.5', '1.7'])(
    'emits an AES-256 R6 (/V 5 /R 6 /AESV3) encryption dict for a %s source header',
    async (version) => {
      const pdfBuffer = await createPdfWithHeader(version);

      const locked = await lockPdf({ pdfBuffer, password: 'letmein!' });
      const dict = encryptDict(locked);

      expect(dict).toMatch(/\/V 5(\D|$)/);
      expect(dict).toMatch(/\/R 6(\D|$)/);
      expect(dict).toMatch(/\/Length 256(\D|$)/);
      expect(dict).toMatch(/\/CFM\s*\/AESV3/);
    }
  );

  // R6 is Adobe extension level 8 to PDF 1.7, which is how qpdf marks its own R6 output.
  it.each([
    ['1.3', '%PDF-1.7'],
    ['1.7', '%PDF-1.7'],
    ['2.0', '%PDF-2.0'],
  ])('marks a %s source as %s with the ADBE extension level 8', async (version, header) => {
    const pdfBuffer = await createPdfWithHeader(version);

    const locked = await lockPdf({ pdfBuffer, password: 'letmein!' });

    expect(locked.subarray(0, header.length).toString('latin1')).toBe(header);
    expect(decryptedObjectStreams(locked, 'letmein!')).toMatch(
      /\/Extensions\s*<<\s*\/ADBE\s*<<\s*\/BaseVersion\s*\/1\.7\s*\/ExtensionLevel\s*8\s*>>\s*>>/
    );
  });

  it('opens in pdf.js with the password, keeping every page and its text, and refuses a wrong one', async () => {
    const pdfBuffer = await createPdfWithHeader('1.3', 3);

    const locked = await lockPdf({ pdfBuffer, password: 'correct horse' });

    expect(await openPdfWithPassword(locked, 'correct horse')).toEqual({ pageTexts: ['Page 1', 'Page 2', 'Page 3'] });
    expect(await openPdfWithPassword(locked, 'wrong horse')).toEqual({ error: 'PasswordException' });
    expect(await openPdfWithPassword(locked, '')).toEqual({ error: 'PasswordException' });
  });

  it('round-trips a password longer than 32 bytes without truncating it', async () => {
    const pdfBuffer = await createPdfWithHeader('1.3');
    const password = `${'A'.repeat(40)}YYYY`;

    const locked = await lockPdf({ pdfBuffer, password });

    expect(await opensWith(locked, password)).toBe(true);
    expect(await opensWith(locked, 'A'.repeat(32))).toBe(false);
    expect(await opensWith(locked, `${'A'.repeat(40)}ZZZZ`)).toBe(false);
  });

  it.each([
    ['accented Latin', 'pásswörd-éü'],
    ['CJK', '密码保护文件安全测试'],
    ['emoji', 'unlock-\u{1F512}\u{1F600}\u{1F44D}'],
  ])('round-trips a %s password in pdf.js', async (_label, password) => {
    const pdfBuffer = await createPdf(1);

    const locked = await lockPdf({ pdfBuffer, password });

    expect(await opensWith(locked, password)).toBe(true);
    expect(await opensWith(locked, 'password')).toBe(false);
  });
});
