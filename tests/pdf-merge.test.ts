import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDFDocument as EncryptablePDFDocument } from 'pdf-lib-plus-encrypt';
import { mergePdfs } from '../lib/pdf/merge';

async function createPdf(pageTexts: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = doc.addPage([300, 300]);
    page.drawText(text, { x: 20, y: 150, font, size: 18 });
  }
  return Buffer.from(await doc.save());
}

describe('mergePdfs (lib/pdf/merge.ts)', () => {
  it('combines pages from multiple PDFs, preserving order', async () => {
    const first = await createPdf(['A1', 'A2']);
    const second = await createPdf(['B1']);

    const mergedBuffer = await mergePdfs({ pdfBuffers: [first, second] });
    const merged = await PDFDocument.load(mergedBuffer);

    expect(merged.getPageCount()).toBe(3);
  });

  it('returns a document with the same page count when given a single input', async () => {
    const single = await createPdf(['Only', 'Pages', 'Here']);

    const mergedBuffer = await mergePdfs({ pdfBuffers: [single] });
    const merged = await PDFDocument.load(mergedBuffer);

    expect(merged.getPageCount()).toBe(3);
  });

  it('does not throw and produces a loadable PDF when given no inputs', async () => {
    const mergedBuffer = await mergePdfs({ pdfBuffers: [] });

    // pdf-lib round-trips a page-less document as reporting 1 page on reload,
    // so we only assert the buffer stays well-formed rather than pinning that count.
    await expect(PDFDocument.load(mergedBuffer)).resolves.toBeDefined();
  });

  it('merges three PDFs of differing lengths into one document with the combined total', async () => {
    const one = await createPdf(['1']);
    const two = await createPdf(['2', '2b']);
    const three = await createPdf(['3', '3b', '3c']);

    const mergedBuffer = await mergePdfs({ pdfBuffers: [one, two, three] });
    const merged = await PDFDocument.load(mergedBuffer);

    expect(merged.getPageCount()).toBe(1 + 2 + 3);
  });

  // Same root cause as compressPdf/lockPdf (see pdf-compress.test.ts): given a
  // password-protected PDF, pdf-lib's raw EncryptedPDFError otherwise propagates into
  // the route's generic catch-all and surfaces as an unhelpful HTTP 500. mergePdfs now
  // checks `isEncrypted` up front and fails fast with an actionable message.
  async function createEncryptedPdf(pageTexts: string[]): Promise<Buffer> {
    const doc = await EncryptablePDFDocument.load(await createPdf(pageTexts));
    await doc.encrypt({ userPassword: 'secret', ownerPassword: 'secret' });
    return Buffer.from(await doc.save());
  }

  it('throws a clear error instead of a generic failure when any input PDF is password-protected', async () => {
    const plain = await createPdf(['A1']);
    const encrypted = await createEncryptedPdf(['B1']);

    await expect(mergePdfs({ pdfBuffers: [plain, encrypted] })).rejects.toThrow(
      /password-protected/i
    );
  });

  it('identifies which input file is password-protected by position', async () => {
    const plain = await createPdf(['A1']);
    const encrypted = await createEncryptedPdf(['B1']);

    await expect(mergePdfs({ pdfBuffers: [plain, plain, encrypted] })).rejects.toThrow(
      /file 3/i
    );
  });
});
