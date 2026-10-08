import os from 'os';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { extractPdfTextItems, PdfTextItemsOptions } from '@/lib/convert/find-pdf-extraction';
import { extractPdfPages } from '@/lib/convert/pdf-extraction';
import { PdfExtractionError } from '@/lib/convert/pdf-worker';
import { lockPdf } from '@/lib/pdf/lock';
import { extractTextItemsInProcess } from './helpers/inProcessPdfText';
import { createSlowPdf, trackEventLoopStall } from './helpers/slowPdf';

// Every extraction starts a worker thread and loads pdf.js in it, which alone can take
// seconds while other suites compete for the CPU. An extraction that is meant to finish
// therefore gets a deadline no machine should reach, and each test more time than that.
const OPTIONS: PdfTextItemsOptions = { maxPages: 20, deadlineMs: 30_000, maxHeapMb: 256, maxConcurrent: 2 };
jest.setTimeout(60_000);

let ordinaryPdf: Buffer;
let slowPdf: Buffer;

async function createTextPdf(pageTexts: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    doc.addPage([400, 400]).drawText(text, { x: 20, y: 360, font: helvetica, size: 12 });
  }
  return Buffer.from(await doc.save());
}

async function createWrappedProsePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const prose =
    'The board reviewed the integration timeline for the company highlighted in the quarterly report, noting that operating margins expand once the twenty-ninth workstream closes and the multi-page appendix is finalised. ';
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    doc
      .addPage([420, 595])
      .drawText(prose.repeat(6), { x: 30, y: 550, font: times, size: 11, maxWidth: 360, lineHeight: 14 });
  }
  return Buffer.from(await doc.save());
}

async function createMixedLayoutPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([595, 842]);
  page.drawText('Heading in bold', { x: 40, y: 780, font: helvetica, size: 28 });
  page.drawText('Rotated margin note', { x: 560, y: 200, font: courier, size: 9, rotate: degrees(90) });
  page.drawText('Slanted stamp', { x: 200, y: 400, font: helvetica, size: 40, rotate: degrees(33) });
  for (let row = 0; row < 12; row++) {
    for (let column = 0; column < 5; column++) {
      page.drawText(`r${row}c${column}`, { x: 40 + column * 100, y: 700 - row * 18, font: courier, size: 10 });
    }
  }
  page.drawText('Em—dash, “quotes” and £ sign', { x: 40, y: 120, font: helvetica, size: 12 });
  doc.addPage([300, 300]).drawRectangle({ x: 20, y: 20, width: 100, height: 100, color: rgb(1, 0, 0) });
  return Buffer.from(await doc.save());
}

function extract(pdf: Buffer, options: PdfTextItemsOptions = OPTIONS) {
  return extractPdfTextItems(new Uint8Array(pdf), options);
}

// Only for an extraction of `slowPdf` whose kill is the point of the test.
function killedAfter(deadlineMs: number, options: PdfTextItemsOptions = OPTIONS) {
  return extract(slowPdf, { ...options, deadlineMs });
}

async function failureOf(extraction: Promise<unknown>) {
  const error = await extraction.then(
    () => {
      throw new Error('expected the extraction to be rejected');
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(PdfExtractionError);
  return (error as PdfExtractionError).failure;
}

// A worker thread holds a MessagePort open in its parent for as long as it is alive.
function hasRunningWorker(): boolean {
  return process.getActiveResourcesInfo().includes('MessagePort');
}

beforeAll(async () => {
  ordinaryPdf = await createTextPdf(['First page', 'Second page']);
  // Twenty pages that each take seconds to extract: minutes in all, on any machine.
  slowPdf = createSlowPdf(30, 20);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('extractPdfTextItems', () => {
  it('resolves with the positioned text items of each page', async () => {
    const pages = await extract(ordinaryPdf);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([
      { str: 'First page', hasEOL: false, width: expect.any(Number), height: 12, transform: [12, 0, 0, 12, 20, 360] },
    ]);
    expect(pages[1].map((item) => item.str)).toEqual(['Second page']);
  });

  it.each([
    ['wrapped prose over several pages', createWrappedProsePdf],
    ['mixed fonts, sizes, rotation, a table and a page without text', createMixedLayoutPdf],
    ['a Flate-compressed content stream', async () => createSlowPdf(0.01, 2)],
  ])('extracts the same items as pdf.js on the main thread for %s', async (_label, createPdf) => {
    const pdf = await createPdf();

    const [inProcess, inWorker] = await Promise.all([extractTextItemsInProcess(pdf), extract(pdf)]);

    expect(inWorker.flat().length).toBeGreaterThan(0);
    expect({ pages: inWorker }).toEqual(inProcess);
  });

  it('refuses a PDF over the page cap with its real page count, without extracting its text', async () => {
    // Extracting these pages would outlast even this deadline, so only a refusal made
    // before extraction can report the page count.
    const failure = await failureOf(extract(slowPdf, { ...OPTIONS, maxPages: 19 }));

    expect(failure).toEqual({ reason: 'page-limit', pageCount: 20 });
  });

  it('stops at the deadline and leaves the event loop free while it runs', async () => {
    const stopTracking = trackEventLoopStall();
    const startedAt = performance.now();

    const failure = await failureOf(killedAfter(3_000));
    const elapsed = performance.now() - startedAt;
    const longestStall = stopTracking();

    expect(failure).toEqual({ reason: 'deadline' });
    // Left to finish, this extraction takes minutes.
    expect(elapsed).toBeLessThan(30_000);
    // A blocked event loop stalls for the whole extraction, not for a fraction of it.
    expect(longestStall).toBeLessThan(elapsed / 2);
  });

  it('reports a worker that exceeds its heap limit instead of crashing the process', async () => {
    // pdf.js itself does not fit in a heap this small, which makes any PDF exceed it.
    const failure = await failureOf(extract(ordinaryPdf, { ...OPTIONS, maxHeapMb: 8 }));

    expect(failure).toEqual({ reason: 'memory' });
  });

  it.each([
    ['a corrupt PDF', async () => ordinaryPdf.subarray(0, Math.floor(ordinaryPdf.length / 2)), 'InvalidPDFException'],
    ['a file that is not a PDF', async () => Buffer.from('not a pdf at all'), 'InvalidPDFException'],
    [
      'an encrypted PDF',
      async () => lockPdf({ pdfBuffer: ordinaryPdf, password: 'correct-Horse-7!' }),
      'PasswordException',
    ],
  ])('passes on the parser error pdf.js raises on the main thread for %s', async (_label, createPdf, parserErrorName) => {
    const pdf = await createPdf();

    const [inProcess, error] = await Promise.all([
      extractTextItemsInProcess(pdf),
      extract(pdf).catch((rejection: unknown) => rejection),
    ]);

    expect(inProcess).toEqual({ parserError: parserErrorName });
    expect(error).toBeInstanceOf(PdfExtractionError);
    expect((error as PdfExtractionError).failure).toEqual({ reason: 'parser' });
    expect((error as PdfExtractionError).cause).toMatchObject({ name: parserErrorName });
  });

  it('fails rather than extracting in-process when the worker cannot start', async () => {
    jest.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    let isolated!: typeof import('@/lib/convert/find-pdf-extraction');
    await jest.isolateModulesAsync(async () => {
      isolated = await import('@/lib/convert/find-pdf-extraction');
    });

    await expect(isolated.extractPdfTextItems(new Uint8Array(ordinaryPdf), OPTIONS)).rejects.toThrow(
      /Cannot find module/,
    );
    expect(hasRunningWorker()).toBe(false);
  });

  describe('concurrency', () => {
    const ONE_AT_A_TIME: PdfTextItemsOptions = { ...OPTIONS, maxConcurrent: 1 };

    it('refuses an extraction over the limit and runs it once a slot is free', async () => {
      const running = extract(ordinaryPdf, ONE_AT_A_TIME);

      expect(await failureOf(extract(ordinaryPdf, ONE_AT_A_TIME))).toEqual({ reason: 'busy' });
      await running;
      await expect(extract(ordinaryPdf, ONE_AT_A_TIME)).resolves.toHaveLength(2);
    });

    it('counts a PDF to Word extraction against the same limit', async () => {
      const convertingToWord = extractPdfPages(new Uint8Array(ordinaryPdf), ONE_AT_A_TIME);

      expect(await failureOf(extract(ordinaryPdf, ONE_AT_A_TIME))).toEqual({ reason: 'busy' });
      await convertingToWord;
      await expect(extract(ordinaryPdf, ONE_AT_A_TIME)).resolves.toHaveLength(2);
    });

    it('holds a slot a PDF to Word extraction then cannot take', async () => {
      const searching = extract(ordinaryPdf, ONE_AT_A_TIME);

      expect(await failureOf(extractPdfPages(new Uint8Array(ordinaryPdf), ONE_AT_A_TIME))).toEqual({
        reason: 'busy',
      });
      await searching;
      await expect(extractPdfPages(new Uint8Array(ordinaryPdf), ONE_AT_A_TIME)).resolves.toHaveLength(2);
    });

    it('runs extractions side by side up to the limit', async () => {
      const results = await Promise.allSettled([extract(ordinaryPdf), extract(ordinaryPdf), extract(ordinaryPdf)]);

      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
    });

    it.each([
      ['a page-cap refusal', 'page-limit', () => extract(ordinaryPdf, { ...ONE_AT_A_TIME, maxPages: 1 })],
      ['a parser error', 'parser', () => extract(Buffer.from('not a pdf at all'), ONE_AT_A_TIME)],
      ['a deadline kill', 'deadline', () => killedAfter(1_000, ONE_AT_A_TIME)],
      ['a heap limit kill', 'memory', () => extract(ordinaryPdf, { ...ONE_AT_A_TIME, maxHeapMb: 8 })],
    ])('frees its slot after %s', async (_label, reason, failingExtraction) => {
      expect(await failureOf(failingExtraction())).toMatchObject({ reason });

      await expect(extract(ordinaryPdf, ONE_AT_A_TIME)).resolves.toHaveLength(2);
    });
  });

  describe('worker lifetime', () => {
    it('keeps a worker alive only while an extraction runs', async () => {
      const running = killedAfter(1_000).catch(() => undefined);

      expect(hasRunningWorker()).toBe(true);
      await running;
      expect(hasRunningWorker()).toBe(false);
    });

    it.each([
      ['success', () => extract(ordinaryPdf)],
      ['a page-cap refusal', () => extract(ordinaryPdf, { ...OPTIONS, maxPages: 1 })],
      ['a parser error', () => extract(Buffer.from('not a pdf at all'))],
      ['a deadline kill', () => killedAfter(1_000)],
      ['a heap limit kill', () => extract(ordinaryPdf, { ...OPTIONS, maxHeapMb: 8 })],
    ])('has no worker left after %s', async (_label, extraction) => {
      await extraction().catch(() => undefined);

      expect(hasRunningWorker()).toBe(false);
    });
  });
});
