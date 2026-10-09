import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { CONVERSION_LIMITS, IMAGE_TO_PDF_BUSY_MESSAGE, IMAGES_TOO_COMPLEX_MESSAGE } from '@/lib/convert/image-to-pdf-limits';
import { extractPdfPages } from '@/lib/convert/pdf-extraction';
import {
  createPngThatHangsPdfLib,
  createPngWithUnreadablePixels,
  createSvgThatTakesMinutesToRender,
  readPdfPageImages,
} from './helpers/imageFiles';
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
let hangingPng: Buffer;

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
  hangingPng = createPngThatHangsPdfLib();
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
    expect(await res.json()).toEqual({ error: 'Image 2 is not a valid image or is corrupted.' });
    expect(order).toEqual(['event loop turned', 'answered']);
    expect(hasRunningWorker()).toBe(false);
  });

  it('refuses an SVG that would take minutes to render at once, whatever it is called, and converts straight after', async () => {
    const refused = await convert(Buffer.from(createSvgThatTakesMinutesToRender()));
    const converted = await convert(png);

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Unsupported image format. Only PNG and JPEG are supported.' });
    expect(converted.status).toBe(200);
  });

  it('refuses an image over 50 megapixels by name', async () => {
    const res = await convert(png, jpeg, createPngWithUnreadablePixels(10_001, 5_000));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Image 3 is 50.1 megapixels. Each image can be at most 50 megapixels.',
    });
  });

  it('refuses a conversion that outlasts its deadline as too complex, without blocking the event loop', async () => {
    setDeadlines({ guest: 3_000 });
    const stopTracking = trackEventLoopStall();
    const startedAt = performance.now();

    const res = await convert(hangingPng);
    const elapsed = performance.now() - startedAt;
    const longestStall = stopTracking();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: IMAGES_TOO_COMPLEX_MESSAGE });
    expect(elapsed).toBeLessThan(30_000);
    // A blocked event loop stalls for the whole conversion, not for a fraction of it.
    expect(longestStall).toBeLessThan(elapsed / 2);
    expect(hasRunningWorker()).toBe(false);
  });

  it('applies the deadline of the plan making the request', async () => {
    mockUserId = USER_ID;
    mockPlan = 'Basic';
    setDeadlines({ Basic: 1_000 });

    const res = await convert(hangingPng);

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

  it('answers 503 with Retry-After while a PDF extraction and a conversion hold both slots, then recovers', async () => {
    setDeadlines({ guest: 5_000 });
    const slowPdf = createSlowPdf(30, 20);
    const extraction = extractPdfPages(new Uint8Array(slowPdf), {
      maxPages: 20,
      deadlineMs: 5_000,
      maxHeapMb: 256,
      maxConcurrent: 2,
    }).catch(() => undefined);
    const heldConversion = convert(hangingPng);
    await workersStarted(2);

    setDeadlines({});
    const refused = await convert(png);

    expect(refused.status).toBe(503);
    expect(refused.headers.get('Retry-After')).toBe('5');
    expect(await refused.json()).toEqual({ error: IMAGE_TO_PDF_BUSY_MESSAGE });

    await extraction;
    expect((await heldConversion).status).toBe(400);
    expect(hasRunningWorker()).toBe(false);
    expect((await convert(png)).status).toBe(200);
  });
});
