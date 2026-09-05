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

  it('throws when called with an empty password instead of producing an unprotected PDF', async () => {
    const pdfBuffer = await createPdf(1);

    await expect(lockPdf({ pdfBuffer, password: '' })).rejects.toThrow(
      /owner password and user password/i
    );
  });
});
