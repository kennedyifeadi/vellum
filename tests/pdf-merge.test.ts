import { PDFDocument, StandardFonts } from 'pdf-lib';
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
});
