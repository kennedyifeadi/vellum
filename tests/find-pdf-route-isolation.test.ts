import { NextRequest } from 'next/server';
import { PDFDocument, PDFPage, StandardFonts } from 'pdf-lib';
import { extractPdfTextItems } from '@/lib/convert/find-pdf-extraction';
import {
  EXTRACTION_LIMITS,
  FIND_PDF_BUSY_MESSAGE,
  PDF_TOO_COMPLEX_MESSAGE,
} from '@/lib/convert/find-pdf-limits';
import { extractPdfPages } from '@/lib/convert/pdf-extraction';
import { lockPdf } from '@/lib/pdf/lock';
import { createSlowPdf, trackEventLoopStall } from './helpers/slowPdf';

let mockUserId: string | null = null;
let mockPlan = 'Free';
let mockResolvedFiles: unknown[] = [];

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

const recordConversionHistory = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  recordConversionHistory: (...args: unknown[]) => recordConversionHistory(...args),
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

import { POST as handleFindPdf } from '../app/api/convert/find-pdf/route';

// Every search starts a worker thread and loads pdf.js in it, which alone can take
// seconds while other suites compete for the CPU. Searches that are meant to finish
// therefore run under deadlines no machine should reach, not the production ones, and
// each test gets more time than that. A test about the deadline sets its own.
const GENEROUS_DEADLINES_MS = { guest: 30_000, Basic: 30_000, Pro: 30_000, Enterprise: 30_000 };
jest.setTimeout(60_000);

const GENERIC_FAILURE = 'Failed to search and highlight PDF';

let deadlines: { replaceValue(value: typeof GENEROUS_DEADLINES_MS): unknown };
let drawRectangle: jest.SpyInstance;
let loadPdfLibDocument: jest.SpyInstance;
let reportPdf: Buffer;
let slowPdf: Buffer;

function setDeadlines(overrides: Partial<typeof GENEROUS_DEADLINES_MS>) {
  deadlines.replaceValue({ ...GENEROUS_DEADLINES_MS, ...overrides });
}

async function createReportPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const firstPage = doc.addPage([400, 400]);
  firstPage.drawText('The board reviewed the quarterly', { x: 20, y: 360, font: helvetica, size: 12 });
  firstPage.drawText('report before the meeting.', { x: 20, y: 340, font: helvetica, size: 12 });
  doc.addPage([400, 400]).drawText('Nothing to see on this page.', { x: 20, y: 360, font: helvetica, size: 12 });
  doc.addPage([400, 400]).drawText('A second quarterly report followed.', { x: 30, y: 200, font: helvetica, size: 10 });
  return Buffer.from(await doc.save());
}

function fakeFile(buffer: Buffer, name = 'report.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function search(buffer: Buffer, searchTerm = 'quarterly report') {
  mockResolvedFiles = [fakeFile(buffer)];
  const formData = new FormData();
  formData.append('searchTerm', searchTerm);
  return handleFindPdf(
    new NextRequest('http://localhost:3000/api/convert/find-pdf', { method: 'POST', body: formData }),
  );
}

function highlightedRectangles() {
  return drawRectangle.mock.calls.map(([{ x, y, height }]) => ({ x, y, height }));
}

beforeAll(async () => {
  reportPdf = await createReportPdf();
  // As many pages as a guest may search, each taking seconds to extract: over a minute
  // in all, on any machine.
  slowPdf = createSlowPdf(30, 10);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  drawRectangle = jest.spyOn(PDFPage.prototype, 'drawRectangle');
  loadPdfLibDocument = jest.spyOn(PDFDocument, 'load');
  deadlines = jest.replaceProperty(EXTRACTION_LIMITS, 'deadlineMs', GENEROUS_DEADLINES_MS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('find-pdf route — extraction in a worker', () => {
  describe('an ordinary search', () => {
    it('counts the matches and highlights every line a match touches', async () => {
      const res = await search(reportPdf);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, pdfBase64: expect.any(String), matches: [], matchCount: 2 });
      expect(highlightedRectangles()).toEqual([
        { x: 20, y: 360, height: 12 },
        { x: 20, y: 340, height: 12 },
        { x: 30, y: 200, height: 10 },
      ]);
    });

    it('returns the uploaded document with its pages intact', async () => {
      const res = await search(reportPdf);

      const highlighted = await PDFDocument.load(Buffer.from((await res.json()).pdfBase64, 'base64'));
      expect(highlighted.getPageCount()).toBe(3);
      expect(highlighted.getPage(2).getSize()).toEqual({ width: 400, height: 400 });
    });

    it('returns a snippet for each match, with its page, on the plan that lists them', async () => {
      mockUserId = 'user-1';
      mockPlan = 'Pro';

      const res = await search(reportPdf);

      expect(await res.json()).toMatchObject({
        matchCount: 2,
        matches: [
          { page: 1, text: 'quarterly report', snippet: '...board reviewed the quarterly report before the meeting....' },
          { page: 3, text: 'quarterly report', snippet: '...A second quarterly report followed....' },
        ],
      });
    });

    it('reports no match and highlights nothing for an absent term', async () => {
      const res = await search(reportPdf, 'nowhere in the document');

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ matchCount: 0, matches: [] });
      expect(drawRectangle).not.toHaveBeenCalled();
    });

    it('records the page and match counts for a signed-in user', async () => {
      mockUserId = 'user-1';
      mockPlan = 'Basic';

      await search(reportPdf, 'Quarterly Report');

      expect(recordConversionHistory).toHaveBeenCalledWith('user-1', 'Find in PDF', 'report.pdf', reportPdf.length, {
        pages: 3,
        matchesFound: 2,
        searchTerm: 'quarterly report',
      });
    });
  });

  describe('page cap', () => {
    it('refuses an over-cap PDF with the plan message before extracting any text', async () => {
      // Extracting these pages would outlast even the generous deadline, so only a
      // refusal made before extraction can answer with the page cap.
      const res = await search(createSlowPdf(30, 11));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Your current plan allows searching up to 10 pages per document.',
      });
      expect(loadPdfLibDocument).not.toHaveBeenCalled();
    });

    it('holds a signed-in user to the page cap of their own plan', async () => {
      mockUserId = 'user-1';
      mockPlan = 'Basic';

      const res = await search(createSlowPdf(30, 51));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Your current plan allows searching up to 50 pages per document.',
      });
      expect(recordConversionHistory).not.toHaveBeenCalled();
    });
  });

  describe('extraction isolation', () => {
    it('refuses a PDF that outlasts the deadline without blocking the event loop', async () => {
      setDeadlines({ guest: 3_000 });
      const stopTracking = trackEventLoopStall();
      const startedAt = performance.now();

      const res = await search(slowPdf, 'x');
      const elapsed = performance.now() - startedAt;
      const longestStall = stopTracking();

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: PDF_TOO_COMPLEX_MESSAGE });
      // Left to finish, this extraction takes over a minute.
      expect(elapsed).toBeLessThan(30_000);
      // A blocked event loop stalls for the whole extraction, not for a fraction of it.
      expect(longestStall).toBeLessThan(elapsed / 2);
      expect(loadPdfLibDocument).not.toHaveBeenCalled();
    });

    it('holds a signed-in user to the deadline of their own plan', async () => {
      setDeadlines({ Pro: 1_000 });
      mockUserId = 'user-1';
      mockPlan = 'Pro';

      const res = await search(slowPdf, 'x');

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: PDF_TOO_COMPLEX_MESSAGE });
      expect(recordConversionHistory).not.toHaveBeenCalled();
    });

    it('refuses a PDF that exceeds the heap limit and keeps serving afterwards', async () => {
      // pdf.js itself does not fit in a heap this small, which makes any PDF exceed it.
      const heapLimit = jest.replaceProperty(EXTRACTION_LIMITS, 'maxHeapMb', 8);
      const refused = await search(reportPdf);
      heapLimit.restore();

      const searched = await search(reportPdf);

      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: PDF_TOO_COMPLEX_MESSAGE });
      expect(searched.status).toBe(200);
      expect((await searched.json()).matchCount).toBe(2);
    });

    it.each([
      ['a corrupt PDF', async (pdf: Buffer) => pdf.subarray(0, Math.floor(pdf.length / 2)), 'InvalidPDFException'],
      ['a file that is not a PDF', async () => Buffer.from('not a pdf at all'), 'InvalidPDFException'],
      [
        'an encrypted PDF',
        (pdf: Buffer) => lockPdf({ pdfBuffer: pdf, password: 'correct-Horse-7!' }),
        'PasswordException',
      ],
    ])('still returns a generic 500 for %s and logs the parser error', async (_label, damage, parserErrorName) => {
      const res = await search(await damage(reportPdf));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: GENERIC_FAILURE });
      expect(console.error).toHaveBeenCalledWith(
        `[convert] ${GENERIC_FAILURE}`,
        expect.objectContaining({ name: parserErrorName }),
      );
    });

    it('answers 503 with Retry-After while searches and PDF to Word hold every slot, then recovers', async () => {
      const occupiedFor = { deadlineMs: 5_000, maxHeapMb: 256, maxConcurrent: 2, maxPages: 10 };
      // Each holds a slot until its deadline; the request below needs no worker to be
      // refused, so it is answered long before that.
      const convertingToWord = extractPdfPages(new Uint8Array(slowPdf), occupiedFor).catch(() => undefined);
      const searching = extractPdfTextItems(new Uint8Array(slowPdf), occupiedFor).catch(() => undefined);

      const busy = await search(reportPdf);
      const documentsLoadedWhileBusy = loadPdfLibDocument.mock.calls.length;
      await Promise.all([convertingToWord, searching]);
      const recovered = await search(reportPdf);

      expect(busy.status).toBe(503);
      expect(busy.headers.get('Retry-After')).toBe('5');
      expect(await busy.json()).toEqual({ error: FIND_PDF_BUSY_MESSAGE });
      expect(documentsLoadedWhileBusy).toBe(0);
      expect(recovered.status).toBe(200);
      expect((await recovered.json()).matchCount).toBe(2);
    });

    it('is refused while PDF to Word alone holds every slot', async () => {
      jest.replaceProperty(EXTRACTION_LIMITS, 'maxConcurrent', 1);
      const convertingToWord = extractPdfPages(new Uint8Array(slowPdf), {
        deadlineMs: 5_000,
        maxHeapMb: 256,
        maxConcurrent: 1,
        maxPages: 10,
      }).catch(() => undefined);

      const busy = await search(reportPdf);
      await convertingToWord;

      expect(busy.status).toBe(503);
      expect(await busy.json()).toEqual({ error: FIND_PDF_BUSY_MESSAGE });
    });
  });
});
