import { PDFDocument, StandardFonts } from 'pdf-lib';
import { splitPdf } from '../lib/pdf/split';

async function createPdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 300]);
    page.drawText(`Page ${i + 1}`, { x: 20, y: 150, font, size: 18 });
  }
  return Buffer.from(await doc.save());
}

describe('splitPdf (lib/pdf/split.ts)', () => {
  it('splits every page into its own single-page PDF when splitEvery is true', async () => {
    const pdfBuffer = await createPdf(3);

    const result = await splitPdf({
      pdfBuffer,
      splitEvery: true,
      outputFileNamePrefix: 'doc',
    });

    expect(result.size).toBe(3);
    expect([...result.keys()]).toEqual(['doc_page_1.pdf', 'doc_page_2.pdf', 'doc_page_3.pdf']);

    for (const buffer of result.values()) {
      const single = await PDFDocument.load(buffer);
      expect(single.getPageCount()).toBe(1);
    }
  });

  it('extracts a specific page range into a single PDF', async () => {
    const pdfBuffer = await createPdf(5);

    const result = await splitPdf({
      pdfBuffer,
      startPage: 2,
      endPage: 4,
      splitEvery: false,
      outputFileNamePrefix: 'range',
    });

    expect(result.size).toBe(1);
    const [fileName, buffer] = [...result.entries()][0];
    expect(fileName).toBe('range_pages_2_to_4.pdf');

    const extracted = await PDFDocument.load(buffer);
    expect(extracted.getPageCount()).toBe(3);
  });

  it('clamps an out-of-range endPage down to the last page of the document', async () => {
    const pdfBuffer = await createPdf(3);

    const result = await splitPdf({
      pdfBuffer,
      startPage: 1,
      endPage: 999,
      splitEvery: false,
      outputFileNamePrefix: 'clamped',
    });

    const [fileName, buffer] = [...result.entries()][0];
    expect(fileName).toBe('clamped_pages_1_to_3.pdf');

    const extracted = await PDFDocument.load(buffer);
    expect(extracted.getPageCount()).toBe(3);
  });

  it('clamps a startPage below 1 up to the first page', async () => {
    const pdfBuffer = await createPdf(4);

    const result = await splitPdf({
      pdfBuffer,
      startPage: -5,
      endPage: 2,
      splitEvery: false,
      outputFileNamePrefix: 'clamped-start',
    });

    const [fileName, buffer] = [...result.entries()][0];
    expect(fileName).toBe('clamped-start_pages_1_to_2.pdf');

    const extracted = await PDFDocument.load(buffer);
    expect(extracted.getPageCount()).toBe(2);
  });

  it('handles a reversed page range (startPage greater than endPage) by normalizing the bounds', async () => {
    const pdfBuffer = await createPdf(5);

    const result = await splitPdf({
      pdfBuffer,
      startPage: 4,
      endPage: 2,
      splitEvery: false,
      outputFileNamePrefix: 'reversed',
    });

    const [fileName, buffer] = [...result.entries()][0];
    expect(fileName).toBe('reversed_pages_2_to_4.pdf');

    const extracted = await PDFDocument.load(buffer);
    expect(extracted.getPageCount()).toBe(3);
  });

  it('extracts a single page when startPage equals endPage', async () => {
    const pdfBuffer = await createPdf(3);

    const result = await splitPdf({
      pdfBuffer,
      startPage: 2,
      endPage: 2,
      splitEvery: false,
      outputFileNamePrefix: 'single',
    });

    const [fileName, buffer] = [...result.entries()][0];
    expect(fileName).toBe('single_pages_2_to_2.pdf');

    const extracted = await PDFDocument.load(buffer);
    expect(extracted.getPageCount()).toBe(1);
  });
});
