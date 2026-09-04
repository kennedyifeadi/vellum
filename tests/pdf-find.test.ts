import { PDFDocument, StandardFonts } from 'pdf-lib';
import { findTextInPdf } from '../lib/pdf/find';

async function createPdf(pageLines: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pageLines) {
    const page = doc.addPage([300, 300]);
    lines.forEach((line, index) => {
      page.drawText(line, { x: 20, y: 260 - index * 20, font, size: 14 });
    });
  }
  return Buffer.from(await doc.save());
}

describe('findTextInPdf (lib/pdf/find.ts)', () => {
  it('finds a case-insensitive match and reports its surrounding context', async () => {
    const pdfBuffer = await createPdf([['The quick brown fox', 'jumps over the lazy dog']]);

    const results = await findTextInPdf({ pdfBuffer, searchText: 'FOX' });

    expect(results).toHaveLength(1);
    expect(results[0].occurrences).toBe(1);
    expect(results[0].context).toContain('The quick brown fox');
  });

  it('counts multiple matching lines within the same page as separate occurrences', async () => {
    const pdfBuffer = await createPdf([['cat sat on the mat', 'the cat ran away']]);

    const results = await findTextInPdf({ pdfBuffer, searchText: 'cat' });

    expect(results).toHaveLength(1);
    expect(results[0].occurrences).toBe(2);
  });

  it('returns an empty array when there are no matches', async () => {
    const pdfBuffer = await createPdf([['Nothing relevant here']]);

    const results = await findTextInPdf({ pdfBuffer, searchText: 'zzzznotfound' });

    expect(results).toEqual([]);
  });

  // Documents a real bug: findTextInPdf splits pdf-parse's output on blank lines to infer
  // page boundaries, but pdf-parse inserts its own "-- N of M --" separator lines (each
  // surrounded by blank lines) between pages. Those separators get counted as extra
  // "pages" of their own, so the reported `page` numbers drift away from the PDF's real
  // page numbers on any multi-page document (page 2 content is reported as page 3 here).
  it('currently misreports page numbers on multi-page documents', async () => {
    const pdfBuffer = await createPdf([['fox on page one'], ['fox on page two']]);

    const results = await findTextInPdf({ pdfBuffer, searchText: 'fox' });

    expect(results).toHaveLength(2);
    expect(results[0].page).toBe(1);
    expect(results[1].page).toBe(3);
  });

  // Documents a real bug: searchText is interpolated directly into `new RegExp(...)`
  // without escaping, so a search term containing regex metacharacters throws instead of
  // being treated as a literal string.
  it('currently throws when the search text contains unbalanced regex metacharacters', async () => {
    const pdfBuffer = await createPdf([['Cost: (approx']]);

    await expect(findTextInPdf({ pdfBuffer, searchText: '(approx' })).rejects.toThrow(
      /invalid regular expression/i
    );
  });
});
