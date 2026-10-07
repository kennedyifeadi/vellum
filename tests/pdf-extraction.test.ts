import os from 'os';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractPdfPages, PdfExtractionError, PdfExtractionOptions } from '@/lib/convert/pdf-extraction';
import { lockPdf } from '@/lib/pdf/lock';
import { createSlowPdf, trackEventLoopStall } from './helpers/slowPdf';

const OPTIONS: PdfExtractionOptions = { maxPages: 10, deadlineMs: 20_000, maxHeapMb: 256, maxConcurrent: 2 };
const SHORT_DEADLINE: PdfExtractionOptions = { ...OPTIONS, deadlineMs: 1_000 };

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

function extract(pdf: Buffer, options: PdfExtractionOptions = OPTIONS) {
  return extractPdfPages(new Uint8Array(pdf), options);
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
  slowPdf = createSlowPdf(30);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('extractPdfPages', () => {
  it('resolves with the text of each page', async () => {
    await expect(extract(ordinaryPdf)).resolves.toEqual([
      { num: 1, text: 'First page' },
      { num: 2, text: 'Second page' },
    ]);
  });

  it('refuses a PDF over the page cap with its real page count, without extracting its text', async () => {
    // Extracting any of these pages would outlast the deadline, so only a refusal made
    // before extraction can report the page count.
    const failure = await failureOf(extract(createSlowPdf(30, 7), { ...SHORT_DEADLINE, maxPages: 6 }));

    expect(failure).toEqual({ reason: 'page-limit', pageCount: 7 });
  });

  it('stops at the deadline and leaves the event loop free while it runs', async () => {
    const stopTracking = trackEventLoopStall();
    const startedAt = performance.now();

    const failure = await failureOf(extract(slowPdf, SHORT_DEADLINE));

    expect(failure).toEqual({ reason: 'deadline' });
    expect(performance.now() - startedAt).toBeLessThan(4_000);
    expect(stopTracking()).toBeLessThan(500);
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
  ])('passes on the parser error for %s', async (_label, createPdf, parserErrorName) => {
    const error = await extract(await createPdf()).catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(PdfExtractionError);
    expect((error as PdfExtractionError).failure).toEqual({ reason: 'parser' });
    expect((error as PdfExtractionError).cause).toMatchObject({ name: parserErrorName });
  });

  it('fails rather than extracting in-process when the worker cannot start', async () => {
    jest.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    let isolated!: typeof import('@/lib/convert/pdf-extraction');
    await jest.isolateModulesAsync(async () => {
      isolated = await import('@/lib/convert/pdf-extraction');
    });

    await expect(isolated.extractPdfPages(new Uint8Array(ordinaryPdf), OPTIONS)).rejects.toThrow(
      /Cannot find module/,
    );
    expect(hasRunningWorker()).toBe(false);
  });

  describe('concurrency', () => {
    const ONE_AT_A_TIME: PdfExtractionOptions = { ...SHORT_DEADLINE, maxConcurrent: 1 };

    it('refuses an extraction over the limit and runs it once a slot is free', async () => {
      const running = extract(ordinaryPdf, ONE_AT_A_TIME);

      expect(await failureOf(extract(ordinaryPdf, ONE_AT_A_TIME))).toEqual({ reason: 'busy' });
      await running;
      await expect(extract(ordinaryPdf, ONE_AT_A_TIME)).resolves.toHaveLength(2);
    });

    it('runs extractions side by side up to the limit', async () => {
      const results = await Promise.allSettled([extract(ordinaryPdf), extract(ordinaryPdf), extract(ordinaryPdf)]);

      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
    });

    it.each([
      ['a page-cap refusal', () => extract(ordinaryPdf, { ...ONE_AT_A_TIME, maxPages: 1 })],
      ['a parser error', () => extract(Buffer.from('not a pdf at all'), ONE_AT_A_TIME)],
      ['a deadline kill', () => extract(slowPdf, ONE_AT_A_TIME)],
      ['a heap limit kill', () => extract(ordinaryPdf, { ...ONE_AT_A_TIME, maxHeapMb: 8 })],
    ])('frees its slot after %s', async (_label, failingExtraction) => {
      await expect(failingExtraction()).rejects.toBeInstanceOf(PdfExtractionError);

      await expect(extract(ordinaryPdf, ONE_AT_A_TIME)).resolves.toHaveLength(2);
    });
  });

  describe('worker lifetime', () => {
    it('keeps a worker alive only while an extraction runs', async () => {
      const running = extract(slowPdf, SHORT_DEADLINE).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(hasRunningWorker()).toBe(true);
      await running;
      expect(hasRunningWorker()).toBe(false);
    });

    it.each([
      ['success', () => extract(ordinaryPdf)],
      ['a page-cap refusal', () => extract(ordinaryPdf, { ...OPTIONS, maxPages: 1 })],
      ['a parser error', () => extract(Buffer.from('not a pdf at all'))],
      ['a deadline kill', () => extract(slowPdf, SHORT_DEADLINE)],
      ['a heap limit kill', () => extract(ordinaryPdf, { ...OPTIONS, maxHeapMb: 8 })],
    ])('has no worker left after %s', async (_label, extraction) => {
      await extraction().catch(() => undefined);

      expect(hasRunningWorker()).toBe(false);
    });
  });
});
