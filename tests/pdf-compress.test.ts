import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { PDFDocument as EncryptablePDFDocument } from 'pdf-lib-plus-encrypt';
import { compressPdf } from '../lib/pdf/compress';
import { lockPdf } from '../lib/pdf/lock';
import { ClientError } from '../lib/convert/errors';

async function createPdf(pageCount: number, withAnnotation = false): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle('Confidential Report');
  doc.setAuthor('Jane Doe');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 300]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: 150, font, size: 18 });
    if (withAnnotation) {
      page.node.set(PDFName.of('Annots'), doc.context.obj([]));
    }
  }
  return Buffer.from(await doc.save());
}

describe('compressPdf (lib/pdf/compress.ts)', () => {
  it('returns a valid PDF with the same page count for a text-only document', async () => {
    const pdfBuffer = await createPdf(3);

    const result = await compressPdf({ pdfBuffer, level: 'low' });

    expect(result.originalSize).toBe(pdfBuffer.length);
    expect(result.compressedSize).toBe(result.buffer.length);
    expect(result.compressedSize).toBeGreaterThan(0);

    const reloaded = await PDFDocument.load(result.buffer);
    expect(reloaded.getPageCount()).toBe(3);
  });

  it.each(['low', 'medium', 'high'] as const)('strips document metadata at %s level', async (level) => {
    const pdfBuffer = await createPdf(1);

    const result = await compressPdf({ pdfBuffer, level });
    const reloaded = await PDFDocument.load(result.buffer);

    expect(reloaded.getTitle()).toBe('');
    expect(reloaded.getAuthor()).toBe('');
  });

  it('preserves page-level annotations at the low compression level', async () => {
    const pdfBuffer = await createPdf(1, true);

    const result = await compressPdf({ pdfBuffer, level: 'low' });
    const reloaded = await PDFDocument.load(result.buffer);

    expect(reloaded.getPage(0).node.get(PDFName.of('Annots'))).toBeDefined();
  });

  it('strips page-level annotations at the high compression level', async () => {
    const pdfBuffer = await createPdf(1, true);

    const result = await compressPdf({ pdfBuffer, level: 'high' });
    const reloaded = await PDFDocument.load(result.buffer);

    expect(reloaded.getPage(0).node.get(PDFName.of('Annots'))).toBeUndefined();
  });

  it('handles a PDF with no pages without throwing', async () => {
    const emptyDoc = await PDFDocument.create();
    const pdfBuffer = Buffer.from(await emptyDoc.save());

    const result = await compressPdf({ pdfBuffer, level: 'medium' });

    // pdf-lib round-trips a page-less document as reporting 1 page on reload,
    // so we only assert the buffer stays well-formed rather than pinning that count.
    await expect(PDFDocument.load(result.buffer)).resolves.toBeDefined();
  });

  // pdf-lib loads an encrypted PDF fine when `ignoreEncryption: true` is passed, but it
  // never decrypts the underlying object streams, so anything that walks the page tree
  // (getPages, save, etc.) fails deep inside pdf-lib with a confusing raw TypeError.
  // Neither pdf-lib nor pdf-lib-plus-encrypt support decrypting on load, so compressPdf
  // now checks `isEncrypted` up front and fails fast with an actionable message instead.
  it('throws a clear error instead of crashing on a password-protected PDF', async () => {
    const plainDoc = await EncryptablePDFDocument.load(await createPdf(2));
    await plainDoc.encrypt({ userPassword: 'secret', ownerPassword: 'secret' });
    const encryptedBuffer = Buffer.from(await plainDoc.save());

    await expect(compressPdf({ pdfBuffer: encryptedBuffer, level: 'medium' })).rejects.toThrow(
      /password-protected/i
    );
  });

  it('throws the same clear error for a PDF locked via lockPdf', async () => {
    const pdfBuffer = await createPdf(2);
    const lockedBuffer = await lockPdf({ pdfBuffer, password: 'secret' });

    await expect(compressPdf({ pdfBuffer: lockedBuffer, level: 'low' })).rejects.toThrow(
      /password-protected/i
    );
  });

  it('rejects an empty buffer as a ClientError, not a generic failure', async () => {
    await expect(compressPdf({ pdfBuffer: Buffer.alloc(0), level: 'medium' })).rejects.toBeInstanceOf(
      ClientError
    );
    await expect(compressPdf({ pdfBuffer: Buffer.alloc(0), level: 'medium' })).rejects.toThrow(/empty/i);
  });

  it('rejects non-PDF input as a ClientError describing corruption', async () => {
    const notaPdf = Buffer.from('PNG\x89 not really a pdf');
    await expect(compressPdf({ pdfBuffer: notaPdf, level: 'low' })).rejects.toBeInstanceOf(ClientError);
    await expect(compressPdf({ pdfBuffer: notaPdf, level: 'low' })).rejects.toThrow(
      /not a valid PDF or is corrupted/i
    );
  });

  it('rejects a truncated PDF as a ClientError describing corruption', async () => {
    const truncated = (await createPdf(3)).subarray(0, 100);
    await expect(compressPdf({ pdfBuffer: truncated, level: 'low' })).rejects.toBeInstanceOf(
      ClientError
    );
  });
});
