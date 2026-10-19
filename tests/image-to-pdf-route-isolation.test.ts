import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { CONVERSION_LIMITS, IMAGE_TO_PDF_BUSY_MESSAGE, IMAGES_TOO_COMPLEX_MESSAGE } from '@/lib/convert/image-to-pdf-limits';
import { extractPdfPages } from '@/lib/convert/pdf-extraction';
import { runImageJob } from '@/lib/image/image-jobs';
import {
  createPngWithUnreadablePixels,
  createSvgThatTakesMinutesToRender,
  readPdfPageImages,
} from './helpers/imageFiles';
import { createSlowPdf } from './helpers/slowPdf';

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

const saveConversionRecord = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: (...args: unknown[]) => saveConversionRecord(...args),
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

import { POST as handleImageToPdf } from '../app/api/convert/image-to-pdf/route';

// Every conversion starts a worker thread and loads pdf-lib in it, which alone can take
// seconds while other suites compete for the CPU. Conversions that are meant to finish
// therefore run under deadlines no machine should reach, not the production ones, and
// each test gets more time than that. A test about the deadline sets its own.
const GENEROUS_DEADLINES_MS = { guest: 30_000, Basic: 30_000, Pro: 30_000, Enterprise: 30_000 };
jest.setTimeout(60_000);

const USER_ID = '507f1f77bcf86cd799439011';

let deadlines: { replaceValue(value: typeof GENEROUS_DEADLINES_MS): unknown };
let png: Buffer;
let jpeg: Buffer;

function setDeadlines(overrides: Partial<typeof GENEROUS_DEADLINES_MS>) {
  deadlines.replaceValue({ ...GENEROUS_DEADLINES_MS, ...overrides });
}

function fakeFile(buffer: Buffer, name = 'picture.png') {
  return {
    name,
    type: 'image/png',
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function convert(...images: Buffer[]) {
  mockResolvedFiles = images.map((image) => fakeFile(image));
  return handleImageToPdf(
    new NextRequest('http://localhost:3000/api/convert/image-to-pdf', { method: 'POST', body: new FormData() }),
  );
}

// A worker thread holds a MessagePort open in its parent for as long as it is alive.
function hasRunningWorker(): boolean {
  return process.getActiveResourcesInfo().includes('MessagePort');
}

function countRunningWorkers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'MessagePort').length;
}

async function workersStarted(count: number): Promise<void> {
  while (countRunningWorkers() < count) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeAll(async () => {
  png = await sharp({ create: { width: 100, height: 50, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png()
    .toBuffer();
  jpeg = await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 0, g: 160, b: 60 } } })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  deadlines = jest.replaceProperty(CONVERSION_LIMITS, 'deadlineMs', GENEROUS_DEADLINES_MS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('image-to-pdf route — conversion in a worker', () => {
  it('converts ordinary images for a guest', async () => {
    const res = await convert(png, jpeg);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="converted_images.pdf"');
    const pages = await readPdfPageImages(Buffer.from(await res.arrayBuffer()));
    expect(pages.map(({ filter }) => filter)).toEqual(['FlateDecode', 'DCTDecode']);
    expect(pages[1].storedBytes.equals(jpeg)).toBe(true);
    expect(hasRunningWorker()).toBe(false);
  });

  it('records the PDF it returned for a signed-in user', async () => {
    mockUserId = USER_ID;
    mockPlan = 'Pro';

    const res = await convert(png);

    const pdf = Buffer.from(await res.arrayBuffer());
    expect(res.status).toBe(200);
    expect(saveConversionRecord).toHaveBeenCalledWith(USER_ID, 'Image to PDF', 'picture.pdf', pdf);
  });

  it('answers the 72-byte PNG that used to hang the server with a 400, the event loop free', async () => {
    const order: string[] = [];

    const response = convert(png, createPngWithUnreadablePixels()).finally(() => order.push('answered'));
    await new Promise((resolve) => setImmediate(resolve));
    order.push('event loop turned');
    const res = await response;

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Image 2 is damaged or incomplete and could not be read.' });
    expect(order).toEqual(['event loop turned', 'answered']);
    expect(hasRunningWorker()).toBe(false);
  });

  it('refuses an SVG that would take minutes to render at once, whatever it is called, and converts straight after', async () => {
    const refused = await convert(Buffer.from(createSvgThatTakesMinutesToRender()));
    const converted = await convert(png);

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: 'Image 1 is not a supported image type. Only JPEG, PNG, WebP, GIF, TIFF, AVIF and BMP images are accepted.',
    });
    expect(converted.status).toBe(200);
  });

  it('refuses an image over 50 megapixels by name', async () => {
    const res = await convert(png, jpeg, createPngWithUnreadablePixels(10_001, 5_000));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Image 3 is 50.1 megapixels. Each image can be at most 50 megapixels.',
    });
  });

  it('refuses a conversion that outlasts its deadline as too complex, with no worker left', async () => {
    setDeadlines({ guest: 0 });

    const res = await convert(png);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: IMAGES_TOO_COMPLEX_MESSAGE });
    expect(hasRunningWorker()).toBe(false);
  });

  it('applies the deadline of the plan making the request', async () => {
    mockUserId = USER_ID;
    mockPlan = 'Basic';
    setDeadlines({ Basic: 0 });

    const res = await convert(png);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: IMAGES_TOO_COMPLEX_MESSAGE });
    expect(saveConversionRecord).not.toHaveBeenCalled();
  });

  it('refuses a conversion that exceeds the heap limit as too complex', async () => {
    // pdf-lib itself does not fit in a heap this small, which makes any image exceed it.
    jest.replaceProperty(CONVERSION_LIMITS, 'maxHeapMb', 8);

    const res = await convert(png);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: IMAGES_TOO_COMPLEX_MESSAGE });
    expect(hasRunningWorker()).toBe(false);
  });

  it('answers 503 with Retry-After while two PDF extractions hold both worker slots, then recovers', async () => {
    const slowPdf = createSlowPdf(30, 20);
    const extractions = [1, 2].map(() =>
      extractPdfPages(new Uint8Array(slowPdf), { maxPages: 20, deadlineMs: 5_000, maxHeapMb: 256, maxConcurrent: 2 }).catch(
        () => undefined,
      ),
    );
    await workersStarted(2);

    const refused = await convert(png);

    expect(refused.status).toBe(503);
    expect(refused.headers.get('Retry-After')).toBe('5');
    expect(await refused.json()).toEqual({ error: IMAGE_TO_PDF_BUSY_MESSAGE });

    await Promise.all(extractions);
    expect(hasRunningWorker()).toBe(false);
    expect((await convert(png)).status).toBe(200);
  });

  it('answers 503 with Retry-After while other image tools hold both image job slots, then recovers', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const jobs = [runImageJob(() => held), runImageJob(() => held)];

    const refused = await convert(png);
    release();
    await Promise.all(jobs);

    expect(refused.status).toBe(503);
    expect(refused.headers.get('Retry-After')).toBe('5');
    expect(await refused.json()).toEqual({ error: IMAGE_TO_PDF_BUSY_MESSAGE });
    expect((await convert(png)).status).toBe(200);
  });
});
