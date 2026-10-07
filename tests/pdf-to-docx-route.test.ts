import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import sharp from 'sharp';
import { PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, StandardFonts } from 'pdf-lib';
import { Document, Packer } from 'docx';
import dbConnect from '@/lib/db/mongoose';
import * as pdfExtraction from '@/lib/convert/pdf-extraction';
import { NO_SELECTABLE_TEXT_MESSAGE } from '@/lib/convert/pdf-text';
import {
  CONVERTER_BUSY_MESSAGE,
  EXTRACTION_LIMITS,
  PDF_TOO_COMPLEX_MESSAGE,
} from '@/lib/convert/pdf-to-docx-limits';
import { lockPdf } from '@/lib/pdf/lock';
import { createSlowPdf, trackEventLoopStall } from './helpers/slowPdf';

let mockUserId: string | null = null;
let mockPlan = 'Free';
let mockResolvedFiles: any[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockUserId ? { plan: mockPlan } : null)),
  },
}));

const createConversion = jest.fn().mockResolvedValue(true);
jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: (...args: any[]) => createConversion(...args) },
}));

const mockStored = new Map<string, Buffer>();
jest.mock('@/lib/storage', () => ({
  getStorage: () => ({
    put: async (key: string, data: Buffer) => {
      mockStored.set(key, data);
    },
  }),
  LocalDiskStorage: class {},
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('docx', () => {
  const actual = jest.requireActual('docx');
  return { ...actual, Document: jest.fn((...args: unknown[]) => new actual.Document(...args)) };
});

import { POST as handlePdfToDocx } from '../app/api/convert/pdf-to-docx/route';

const XML_ILLEGAL_CHARS = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
const PAGE_MARKER = /-- \d+ of \d+ --/;
const MB = 1024 * 1024;

// Every conversion starts a worker thread and loads pdf.js in it, which alone can take
// seconds while other suites compete for the CPU. Conversions that are meant to finish
// therefore run under deadlines no machine should reach, not the production ones, and
// each test gets more time than that. A test about the deadline sets its own.
const GENEROUS_DEADLINES_MS = { guest: 30_000, Basic: 30_000, Pro: 30_000, Enterprise: 30_000 };
jest.setTimeout(60_000);

let deadlines: { replaceValue(value: typeof GENEROUS_DEADLINES_MS): unknown };

function setDeadlines(overrides: Partial<typeof GENEROUS_DEADLINES_MS>) {
  deadlines.replaceValue({ ...GENEROUS_DEADLINES_MS, ...overrides });
}

type PageSpec = { text: string[] } | { unmapped: string[] } | { image: true };

/**
 * A Type0 font with no ToUnicode map: pdf.js falls back to the glyph ids, so each
 * UTF-16 code unit drawn with it is extracted verbatim, control characters included.
 */
function registerUnmappedFont(doc: PDFDocument) {
  const descriptor = doc.context.register(
    doc.context.obj({
      Type: 'FontDescriptor',
      FontName: 'Unmapped',
      Flags: 4,
      FontBBox: [0, 0, 1000, 1000],
      ItalicAngle: 0,
      Ascent: 800,
      Descent: -200,
      CapHeight: 700,
      StemV: 80,
    })
  );
  const descendant = doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: 'Unmapped',
      CIDSystemInfo: {
        Registry: PDFHexString.fromText('Adobe'),
        Ordering: PDFHexString.fromText('Identity'),
        Supplement: 0,
      },
      DW: 500,
      FontDescriptor: descriptor,
    })
  );
  return doc.context.register(
    doc.context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'Unmapped',
      Encoding: 'Identity-H',
      DescendantFonts: [descendant],
    })
  );
}

function glyphIds(line: string) {
  const hex = Array.from({ length: line.length }, (_, i) => line.charCodeAt(i).toString(16).padStart(4, '0'));
  return PDFHexString.of(hex.join(''));
}

async function createPdf(pages: PageSpec[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const unmappedFont = registerUnmappedFont(doc);
  const image = await doc.embedPng(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .png()
      .toBuffer()
  );

  for (const spec of pages) {
    const page = doc.addPage([400, 400]);
    if ('image' in spec) {
      page.drawImage(image, { x: 50, y: 50, width: 300, height: 300 });
    } else if ('text' in spec) {
      spec.text.forEach((line, i) => page.drawText(line, { x: 20, y: 360 - i * 20, font: helvetica, size: 12 }));
    } else {
      page.node.setFontDictionary(PDFName.of('Unmapped'), unmappedFont);
      spec.unmapped.forEach((line, i) =>
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.BeginText),
          PDFOperator.of(PDFOperatorNames.SetFontAndSize, [PDFName.of('Unmapped'), doc.context.obj(12)]),
          PDFOperator.of(PDFOperatorNames.MoveText, [doc.context.obj(20), doc.context.obj(360 - i * 20)]),
          PDFOperator.of(PDFOperatorNames.ShowText, [glyphIds(line)]),
          PDFOperator.of(PDFOperatorNames.EndText)
        )
      );
    }
  }
  return Buffer.from(await doc.save());
}

async function createTextPdf(pageCount: number, linesPerPage: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = doc.addPage([400, 1000]);
    for (let lineIndex = 0; lineIndex < linesPerPage; lineIndex++) {
      page.drawText(`p${pageIndex + 1} l${lineIndex + 1}`, { x: 20, y: 985 - lineIndex * 10, font: helvetica, size: 6 });
    }
  }
  return Buffer.from(await doc.save());
}

function fakeFile(buffer: Buffer, size = buffer.length, name = 'report.pdf') {
  return {
    name,
    type: 'application/pdf',
    size,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function postFile(buffer: Buffer, reportedSize?: number) {
  mockResolvedFiles = [fakeFile(buffer, reportedSize)];
  return handlePdfToDocx(
    new NextRequest('http://localhost:3000/api/convert/pdf-to-docx', { method: 'POST', body: new FormData() })
  );
}

async function convert(pages: PageSpec[]) {
  return postFile(await createPdf(pages));
}

async function documentXml(res: Response): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  return zip.file('word/document.xml')!.async('string');
}

function paragraphTexts(xml: string): string[] {
  return Array.from(xml.matchAll(/<w:p>(.*?)<\/w:p>/g), ([, paragraph]) =>
    Array.from(paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g), ([, text]) => text).join('')
  );
}

function pageBreakCount(xml: string): number {
  return (xml.match(/<w:pageBreakBefore\/>/g) ?? []).length;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  (dbConnect as jest.Mock).mockResolvedValue(true);
  mockResolvedFiles = [];
  mockStored.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  deadlines = jest.replaceProperty(EXTRACTION_LIMITS, 'deadlineMs', GENEROUS_DEADLINES_MS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('pdf-to-docx route', () => {
  it('converts an ordinary text PDF with its text unchanged', async () => {
    const res = await convert([{ text: ['Quarterly report', 'Revenue grew 12% year over year.'] }]);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="report.docx"');
    expect(paragraphTexts(await documentXml(res))).toEqual([
      'Quarterly report',
      'Revenue grew 12% year over year.',
    ]);
  });

  it('writes no XML-illegal characters when the extracted text contains control characters', async () => {
    const res = await convert([
      {
        unmapped: [
          'Invoice\u0001 number\u0003 4471 for the March\u001D delivery',
          'Total due\u0000: 1,250.00 café 日本',
        ],
      },
    ]);

    expect(res.status).toBe(200);
    const xml = await documentXml(res);
    expect(xml.match(XML_ILLEGAL_CHARS)).toBeNull();
    expect(paragraphTexts(xml)).toEqual([
      'Invoice number 4471 for the March delivery',
      'Total due: 1,250.00 café 日本',
    ]);
  });

  it('returns 400 for an image-only PDF', async () => {
    const res = await convert([{ image: true }, { image: true }]);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: NO_SELECTABLE_TEXT_MESSAGE });
  });

  it('returns the same 400 when the extraction is dominated by control characters', async () => {
    const res = await convert([
      { unmapped: ['7KH\u0003TXLFN\u0003EURZQ\u0003IR[\u0003MXPSV\u0003RYHU\u0003WKH\u0003OD]\\\u0003GRJ\u0011'] },
    ]);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: NO_SELECTABLE_TEXT_MESSAGE });
  });

  it('does not record a conversion for a rejected PDF', async () => {
    mockUserId = 'user-1';

    const res = await convert([{ image: true }]);

    expect(res.status).toBe(400);
    expect(createConversion).not.toHaveBeenCalled();
  });

  it('keeps the text pages of a mixed PDF and marks each text-less page once', async () => {
    const res = await convert([
      { text: ['Cover page'] },
      { image: true },
      { text: ['Body text'] },
      { image: true },
    ]);

    expect(res.status).toBe(200);
    expect(paragraphTexts(await documentXml(res))).toEqual([
      'Cover page',
      '[Page 2 had no extractable text — it may be an image or a scan.]',
      'Body text',
      '[Page 4 had no extractable text — it may be an image or a scan.]',
    ]);
  });

  it('emits no page markers and breaks the page between pages', async () => {
    const res = await convert([
      { text: ['Page one, first line', 'Page one, second line'] },
      { text: ['Page two'] },
      { text: ['Page three'] },
    ]);

    const xml = await documentXml(res);
    expect(xml).not.toMatch(PAGE_MARKER);
    expect(paragraphTexts(xml)).toEqual([
      'Page one, first line',
      'Page one, second line',
      'Page two',
      'Page three',
    ]);
    expect(pageBreakCount(xml)).toBe(2);
  });

  it('adds no page break to a single-page PDF', async () => {
    const res = await convert([{ text: ['Only page'] }]);

    expect(pageBreakCount(await documentXml(res))).toBe(0);
  });

  it('still returns a generic 500 for a file that is not a PDF', async () => {
    const res = await postFile(Buffer.from('not a pdf at all'));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to convert PDF to DOCX' });
  });

  it('records the page count for a signed-in user', async () => {
    mockUserId = 'user-1';

    const res = await convert([{ text: ['One'] }, { text: ['Two'] }]);

    expect(res.status).toBe(200);
    expect(createConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        toolUsed: 'PDF to DOCX',
        status: 'Completed',
        metadata: expect.objectContaining({ pages: 2 }),
      })
    );
  });

  describe('size cap', () => {
    // The route reads only the upload's reported size before parsing, so a small PDF
    // reporting a large size stands in for a multi-megabyte fixture.
    const DENSE_PAGE: PageSpec[] = [{ text: ['Dense one-page document'] }];

    it('refuses an over-cap PDF before reading or parsing it', async () => {
      const extractPdfPages = jest.spyOn(pdfExtraction, 'extractPdfPages');

      const res = await postFile(await createPdf(DENSE_PAGE), 5 * MB + 1);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error:
          'This PDF is 5.1 MB; your plan allows converting PDFs up to 5 MB to Word. This limit is specific to PDF to Word and is lower than the general upload limit.',
      });
      expect(mockResolvedFiles[0].arrayBuffer).not.toHaveBeenCalled();
      expect(extractPdfPages).not.toHaveBeenCalled();
      expect(Document).not.toHaveBeenCalled();
    });

    it('converts a PDF exactly at the guest cap', async () => {
      const res = await postFile(await createPdf(DENSE_PAGE), 5 * MB);

      expect(res.status).toBe(200);
      expect(paragraphTexts(await documentXml(res))).toEqual(['Dense one-page document']);
    });

    it.each([
      ['Basic', 10],
      ['Pro', 15],
      ['Enterprise', 25],
    ])('holds a %s plan to %d MB', async (plan, capMb) => {
      mockUserId = 'user-1';
      mockPlan = plan;

      const res = await postFile(await createPdf(DENSE_PAGE), capMb * MB + 1);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain(`up to ${capMb} MB to Word`);
      expect(createConversion).not.toHaveBeenCalled();
    });

    it('converts for a Pro user a size a guest is refused', async () => {
      const pdf = await createPdf(DENSE_PAGE);
      const guestRes = await postFile(pdf, 12 * MB);

      mockUserId = 'user-1';
      mockPlan = 'Pro';
      const proRes = await postFile(pdf, 12 * MB);

      expect(guestRes.status).toBe(400);
      expect(proRes.status).toBe(200);
      expect(paragraphTexts(await documentXml(proRes))).toEqual(['Dense one-page document']);
    });

    it('holds a signed-in user with an unrecognised plan to the guest cap', async () => {
      mockUserId = 'user-1';
      mockPlan = 'Platinum';

      const res = await postFile(await createPdf(DENSE_PAGE), 5 * MB + 1);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('up to 5 MB to Word');
    });
  });

  describe('page cap', () => {
    it('rejects an over-cap PDF before extracting any text or building anything', async () => {
      const toBuffer = jest.spyOn(Packer, 'toBuffer');
      // Extracting these pages would outlast even the generous deadline, so only a
      // refusal made before extraction can answer with the page count.
      const res = await postFile(createSlowPdf(30, 101));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'This PDF has 101 pages; your plan allows converting up to 100 pages to Word.',
      });
      expect(Document).not.toHaveBeenCalled();
      expect(toBuffer).not.toHaveBeenCalled();
    });

    it.each([
      ['Basic', 200],
      ['Pro', 300],
      ['Enterprise', 500],
    ])('holds a %s plan to %d pages', async (plan, cap) => {
      mockUserId = 'user-1';
      mockPlan = plan;

      const res = await postFile(await createTextPdf(cap + 1, 0));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: `This PDF has ${cap + 1} pages; your plan allows converting up to ${cap} pages to Word.`,
      });
      expect(createConversion).not.toHaveBeenCalled();
    });

    it('converts a PDF a paid plan allows but a guest would not', async () => {
      mockUserId = 'user-1';
      mockPlan = 'Basic';

      const res = await postFile(await createTextPdf(101, 1));

      expect(res.status).toBe(200);
      expect(paragraphTexts(await documentXml(res))).toHaveLength(101);
    });

    it('converts a PDF exactly at the guest cap', async () => {
      const res = await postFile(await createTextPdf(100, 1));

      expect(res.status).toBe(200);
      expect(paragraphTexts(await documentXml(res))).toHaveLength(100);
    });
  });

  describe('text cap', () => {
    let denseGuestPdf: Buffer;

    beforeAll(async () => {
      denseGuestPdf = await createTextPdf(90, 90);
    }, 30_000);

    it('rejects a PDF under the page cap but over the text cap before building anything', async () => {
      const toBuffer = jest.spyOn(Packer, 'toBuffer');

      const res = await postFile(denseGuestPdf);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'This PDF has 8,100 lines of text; your plan allows converting up to 8,000 lines to Word.',
      });
      expect(Document).not.toHaveBeenCalled();
      expect(toBuffer).not.toHaveBeenCalled();
    });

    it('converts the same PDF on a plan whose text cap allows it', async () => {
      mockUserId = 'user-1';
      mockPlan = 'Basic';

      const res = await postFile(denseGuestPdf);

      expect(res.status).toBe(200);
      expect(paragraphTexts(await documentXml(res))).toHaveLength(8100);
    });
  });

  describe('extraction isolation', () => {
    let slowPdf: Buffer;

    beforeAll(() => {
      // Twenty pages that each take seconds to extract: minutes in all, on any machine.
      slowPdf = createSlowPdf(30, 20);
    });

    it('refuses a PDF that outlasts the deadline without blocking the event loop', async () => {
      setDeadlines({ guest: 3_000 });
      const stopTracking = trackEventLoopStall();
      const startedAt = performance.now();

      const res = await postFile(slowPdf);
      const elapsed = performance.now() - startedAt;
      const longestStall = stopTracking();

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: PDF_TOO_COMPLEX_MESSAGE });
      // Left to finish, this extraction takes minutes.
      expect(elapsed).toBeLessThan(30_000);
      // A blocked event loop stalls for the whole extraction, not for a fraction of it.
      expect(longestStall).toBeLessThan(elapsed / 2);
      expect(Document).not.toHaveBeenCalled();
    });

    it('holds a signed-in user to the deadline of their own plan', async () => {
      setDeadlines({ Pro: 1_000 });
      mockUserId = 'user-1';
      mockPlan = 'Pro';

      const res = await postFile(slowPdf);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: PDF_TOO_COMPLEX_MESSAGE });
      expect(createConversion).not.toHaveBeenCalled();
    });

    it('refuses a PDF that exceeds the heap limit and keeps serving afterwards', async () => {
      // pdf.js itself does not fit in a heap this small, which makes any PDF exceed it.
      const heapLimit = jest.replaceProperty(EXTRACTION_LIMITS, 'maxHeapMb', 8);
      const refused = await convert([{ text: ['Ordinary document'] }]);
      heapLimit.restore();

      const converted = await convert([{ text: ['Ordinary document'] }]);

      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: PDF_TOO_COMPLEX_MESSAGE });
      expect(converted.status).toBe(200);
    });

    it.each([
      ['a corrupt PDF', async (pdf: Buffer) => pdf.subarray(0, Math.floor(pdf.length / 2)), 'InvalidPDFException'],
      [
        'an encrypted PDF',
        (pdf: Buffer) => lockPdf({ pdfBuffer: pdf, password: 'correct-Horse-7!' }),
        'PasswordException',
      ],
    ])('still returns a generic 500 for %s and logs the parser error', async (_label, damage, parserErrorName) => {
      const res = await postFile(await damage(await createPdf([{ text: ['Ordinary document'] }])));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Failed to convert PDF to DOCX' });
      expect(console.error).toHaveBeenCalledWith(
        '[convert] Failed to convert PDF to DOCX',
        expect.objectContaining({ name: parserErrorName }),
      );
    });

    it('answers 503 with Retry-After while every extraction slot is taken, then recovers', async () => {
      jest.replaceProperty(EXTRACTION_LIMITS, 'maxConcurrent', 1);
      const ordinaryPdf = await createPdf([{ text: ['Ordinary document'] }]);
      // Holds the only slot until its deadline; the request below needs no worker to be
      // refused, so it is answered long before that.
      const occupying = pdfExtraction
        .extractPdfPages(new Uint8Array(slowPdf), { maxPages: 20, deadlineMs: 5_000, maxHeapMb: 256, maxConcurrent: 1 })
        .catch(() => undefined);

      const busy = await postFile(ordinaryPdf);
      await occupying;
      const recovered = await postFile(ordinaryPdf);

      expect(busy.status).toBe(503);
      expect(busy.headers.get('Retry-After')).toBe('5');
      expect(await busy.json()).toEqual({ error: CONVERTER_BUSY_MESSAGE });
      expect(Document).toHaveBeenCalledTimes(1);
      expect(recovered.status).toBe(200);
      expect(paragraphTexts(await documentXml(recovered))).toEqual(['Ordinary document']);
    });
  });

  describe('history', () => {
    it('stores the generated document so the history row can re-download it', async () => {
      mockUserId = 'user-1';

      const res = await convert([{ text: ['Member document'] }]);
      const body = Buffer.from(await res.arrayBuffer());

      expect(createConversion).toHaveBeenCalledTimes(1);
      const record = createConversion.mock.calls[0][0];
      expect(record).toMatchObject({
        userId: 'user-1',
        toolUsed: 'PDF to DOCX',
        fileName: 'report.docx',
        fileSize: body.length,
        status: 'Completed',
      });
      expect(record.diskFileName).toMatch(/\.docx$/);
      expect(record.outputUrl).toBe(`/api/download/${record.diskFileName.replace(/\.docx$/, '')}`);

      const stored = mockStored.get(record.diskFileName)!;
      expect(stored.equals(body)).toBe(true);
      const storedDocument = await JSZip.loadAsync(stored);
      expect(storedDocument.file('word/document.xml')).not.toBeNull();
      expect(paragraphTexts(await storedDocument.file('word/document.xml')!.async('string'))).toEqual([
        'Member document',
      ]);
    });

    it('stores nothing for a guest', async () => {
      const res = await convert([{ text: ['Guest document'] }]);

      expect(res.status).toBe(200);
      expect(createConversion).not.toHaveBeenCalled();
      expect(mockStored.size).toBe(0);
    });

    it('still returns the document when the history write fails', async () => {
      mockUserId = 'user-1';
      createConversion.mockRejectedValueOnce(new Error('mongo timeout'));

      const res = await convert([{ text: ['Member document'] }]);

      expect(res.status).toBe(200);
      expect(paragraphTexts(await documentXml(res))).toEqual(['Member document']);
      expect(createConversion).toHaveBeenCalledTimes(1);
    });
  });

  describe('database use', () => {
    it('converts for a guest without connecting to the database', async () => {
      const res = await convert([{ text: ['Guest document'] }]);

      expect(res.status).toBe(200);
      expect(dbConnect).not.toHaveBeenCalled();
    });

    it('converts for a guest while the database is down', async () => {
      (dbConnect as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await convert([{ text: ['Guest document'] }]);

      expect(res.status).toBe(200);
    });

    it('connects and records history for a signed-in user', async () => {
      mockUserId = 'user-1';

      const res = await convert([{ text: ['Member document'] }]);

      expect(res.status).toBe(200);
      expect(dbConnect).toHaveBeenCalled();
      expect(createConversion).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', toolUsed: 'PDF to DOCX', status: 'Completed' })
      );
    });
  });
});
