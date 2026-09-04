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

  // Documents a real bug: even with `ignoreEncryption: true`, plain pdf-lib cannot resolve
  // the page tree of a PDF encrypted via pdf-lib-plus-encrypt — the same root cause that
  // breaks compressPdf on locked input (see pdf-compress.test.ts). Reading the page count
  // back out currently throws rather than succeeding.
  it('currently cannot have its page tree read back even with ignoreEncryption', async () => {
    const pdfBuffer = await createPdf(3);

    const lockedBuffer = await lockPdf({ pdfBuffer, password: 'letmein' });

    const reloaded = await PDFDocument.load(lockedBuffer, { ignoreEncryption: true });
    expect(() => reloaded.getPageCount()).toThrow(TypeError);
  });

  it('throws when called with an empty password instead of producing an unprotected PDF', async () => {
    const pdfBuffer = await createPdf(1);

    await expect(lockPdf({ pdfBuffer, password: '' })).rejects.toThrow(
      /owner password and user password/i
    );
  });
});
