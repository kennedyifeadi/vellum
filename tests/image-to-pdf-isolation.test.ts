import os from 'os';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { ClientError } from '@/lib/convert/errors';
import { extractPdfPages, PdfExtractionError } from '@/lib/convert/pdf-extraction';
import { WorkerJobError, type WorkerLimits } from '@/lib/convert/worker-job';
import { ImageToolBusyError, runImageJob } from '@/lib/image/image-jobs';
import { convertImagesToPdf } from '@/lib/image/to-pdf';
import {
  createAnimatedPng,
  createPngThatHangsPdfLib,
  createPngWithUnreadablePixels,
  createSvgThatTakesMinutesToRender,
  readPdfPageImages,
} from './helpers/imageFiles';
import { createSlowPdf } from './helpers/slowPdf';

// Every conversion starts a worker thread and loads pdf-lib in it, which alone can take
// seconds while other suites compete for the CPU. A conversion that is meant to finish
// therefore gets a deadline no machine should reach, and each test more time than that.
const LIMITS: WorkerLimits = { deadlineMs: 30_000, maxHeapMb: 256, maxConcurrent: 2 };
const ONE_AT_A_TIME: WorkerLimits = { ...LIMITS, maxConcurrent: 1 };
// A conversion given this is refused as busy the moment it asks for a worker, so any
// other outcome was decided before pdf-lib saw the image.
const NO_WORKER_ALLOWED: WorkerLimits = { ...LIMITS, maxConcurrent: 0 };
// Spent before the conversion starts.
const NO_TIME: WorkerLimits = { ...LIMITS, deadlineMs: 0 };
jest.setTimeout(60_000);

const DAMAGED = (imageNumber: number) => `Image ${imageNumber} is damaged or incomplete and could not be read.`;
const UNSUPPORTED = 'Image 1 is not a supported image type. Only JPEG, PNG, WebP, GIF, TIFF, AVIF and BMP images are accepted.';

let png: Buffer;
let jpeg: Buffer;

function flatImage(width: number, height: number, background = { r: 200, g: 30, b: 30 }) {
  return sharp({ create: { width, height, channels: 3, background } });
}

function convert(imageBuffers: Buffer[], limits: WorkerLimits = LIMITS) {
  return convertImagesToPdf({ imageBuffers, limits });
}

async function rejectionOf(conversion: Promise<unknown>): Promise<unknown> {
  return conversion.then(
    () => {
      throw new Error('expected the conversion to be rejected');
    },
    (rejection: unknown) => rejection,
  );
}

async function failureReasonOf(conversion: Promise<unknown>) {
  const error = await rejectionOf(conversion);
  expect(error).toBeInstanceOf(WorkerJobError);
  return (error as WorkerJobError).reason;
}

async function clientErrorOf(conversion: Promise<unknown>) {
  const error = await rejectionOf(conversion);
  expect(error).toBeInstanceOf(ClientError);
  return { status: (error as ClientError).status, message: (error as ClientError).message };
}

// A worker thread holds a MessagePort open in its parent for as long as it is alive.
function hasRunningWorker(): boolean {
  return process.getActiveResourcesInfo().includes('MessagePort');
}

// A conversion decodes its images before it asks for a worker, so it holds a slot a
// moment after the call, not at once.
async function workerStarted(): Promise<void> {
  while (!hasRunningWorker()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Holds both of the image tools' slots, as two Compress Image or JPEG to PNG requests
// would, until the returned function is called.
function holdImageJobSlots(): () => Promise<void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const jobs = [runImageJob(() => held), runImageJob(() => held)];
  return async () => {
    release();
    await Promise.all(jobs);
  };
}

beforeAll(async () => {
  png = await flatImage(100, 50).png().toBuffer();
  jpeg = await flatImage(80, 80, { r: 0, g: 160, b: 60 }).jpeg().toBuffer();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('convertImagesToPdf — a PNG whose pixel data is not a zlib stream (#98)', () => {
  it('is refused as damaged before pdf-lib sees it, with the event loop free', async () => {
    const unreadablePng = createPngWithUnreadablePixels();
    const order: string[] = [];

    const refusal = clientErrorOf(convert([unreadablePng], NO_WORKER_ALLOWED)).finally(() => order.push('refused'));
    await new Promise((resolve) => setImmediate(resolve));
    order.push('event loop turned');

    expect(unreadablePng).toHaveLength(72);
    expect(await refusal).toEqual({ status: 400, message: DAMAGED(1) });
    expect(order).toEqual(['event loop turned', 'refused']);
  });

  it('names the image when it is not the first', async () => {
    const refusal = await clientErrorOf(convert([png, jpeg, createPngWithUnreadablePixels()], NO_WORKER_ALLOWED));

    expect(refusal.message).toBe(DAMAGED(3));
  });

  it('is refused when its header claims a real photograph size', async () => {
    const refusal = await clientErrorOf(convert([createPngWithUnreadablePixels(4000, 3000)], NO_WORKER_ALLOWED));

    expect(refusal.message).toBe(DAMAGED(1));
  });
});

describe('convertImagesToPdf — inputs pdf-lib could not finish', () => {
  it('refuses an SVG that would take minutes to render without rendering it, and converts straight after', async () => {
    const slowSvg = Buffer.from(createSvgThatTakesMinutesToRender());

    const refusal = await clientErrorOf(convert([slowSvg, png], NO_WORKER_ALLOWED));
    const pdf = await convert([png]);

    expect(slowSvg).toHaveLength(233);
    expect(refusal).toEqual({ status: 400, message: UNSUPPORTED });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it('refuses an unsupported image over the pixel limit as unsupported', async () => {
    const hugeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"/>');

    const refusal = await clientErrorOf(convert([hugeSvg], NO_WORKER_ALLOWED));

    expect(refusal.message).toBe(UNSUPPORTED);
  });

  it.each([
    ['an animated PNG', createAnimatedPng],
    ['the animated PNG whose second frame pdf-lib never finished decoding', createPngThatHangsPdfLib],
  ])('refuses %s as animated before pdf-lib sees it', async (_label, createUpload) => {
    const refusal = await clientErrorOf(convert([createUpload()], NO_WORKER_ALLOWED));

    expect(refusal).toEqual({ status: 400, message: 'Image 1 is animated. Animated images are not supported.' });
  });
});

describe('convertImagesToPdf — pixel limit', () => {
  it('converts an image of exactly 50 megapixels', async () => {
    const atLimit = await flatImage(10_000, 5_000).jpeg().toBuffer();

    const [page] = await readPdfPageImages(await convert([atLimit]));

    expect([page.pixelWidth, page.pixelHeight]).toEqual([10_000, 5_000]);
  });

  it.each([
    ['just over the limit', 10_001, 5_000, '50.1'],
    ['over the size its decoder would refuse to open', 20_000, 20_000, '400.0'],
  ])('refuses a PNG %s by name, from its header alone', async (_label, width, height, megapixels) => {
    // The pixel data is unreadable, so a refusal that came after decoding would call
    // the image damaged instead.
    const overLimit = createPngWithUnreadablePixels(width, height);

    const refusal = await clientErrorOf(convert([overLimit], NO_WORKER_ALLOWED));

    expect(refusal).toEqual({
      status: 400,
      message: `Image 1 is ${megapixels} megapixels. Each image can be at most 50 megapixels.`,
    });
  });

  it('refuses a JPEG over the limit too', async () => {
    const overLimit = await flatImage(10_001, 5_000).jpeg().toBuffer();

    const refusal = await clientErrorOf(convert([overLimit], NO_WORKER_ALLOWED));

    expect(refusal.message).toBe('Image 1 is 50.1 megapixels. Each image can be at most 50 megapixels.');
  });

  it('refuses the whole request when one image of several is over the limit', async () => {
    const refusal = await clientErrorOf(convert([png, createPngWithUnreadablePixels(10_001, 5_000), jpeg], NO_WORKER_ALLOWED));

    expect(refusal.message).toBe('Image 2 is 50.1 megapixels. Each image can be at most 50 megapixels.');
  });
});

describe('convertImagesToPdf — the caller', () => {
  it('leaves the caller its image buffers', async () => {
    const before = [Buffer.from(png), Buffer.from(jpeg)];

    await convert([png, jpeg]);

    expect([png, jpeg].map((buffer, index) => buffer.equals(before[index]))).toEqual([true, true]);
  });

  it('converts images held in a view into a larger buffer', async () => {
    const pooled = Buffer.concat([Buffer.from('unrelated bytes before'), jpeg, Buffer.from('and after')]);
    const view = pooled.subarray(22, 22 + jpeg.length);

    const [page] = await readPdfPageImages(await convert([view]));

    expect(page.storedBytes.equals(jpeg)).toBe(true);
  });
});

describe('convertImagesToPdf — deadline, slots and the worker', () => {
  it('refuses a conversion whose deadline passes before its images are ready, without starting a worker', async () => {
    expect(await failureReasonOf(convert([png], NO_TIME))).toBe('deadline');
    expect(hasRunningWorker()).toBe(false);
  });

  it('stops between images once the deadline has passed', async () => {
    const large = await flatImage(3000, 2000).png().toBuffer();

    expect(await failureReasonOf(convert([large, large], { ...LIMITS, deadlineMs: 1 }))).toBe('deadline');
  });

  it('reports a worker that exceeds its heap limit instead of crashing the process', async () => {
    // pdf-lib itself does not fit in a heap this small, which makes any image exceed it.
    expect(await failureReasonOf(convert([png], { ...LIMITS, maxHeapMb: 8 }))).toBe('memory');
  });

  it('fails rather than converting in-process when the worker cannot start', async () => {
    jest.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    let isolated!: typeof import('@/lib/image/to-pdf');
    await jest.isolateModulesAsync(async () => {
      isolated = await import('@/lib/image/to-pdf');
    });

    await expect(isolated.convertImagesToPdf({ imageBuffers: [png], limits: LIMITS })).rejects.toThrow(
      /Cannot find module/,
    );
    expect(hasRunningWorker()).toBe(false);
  });

  describe('image job slots', () => {
    it('refuses a conversion while Compress Image and JPEG to PNG hold both slots, and converts once one is free', async () => {
      const release = holdImageJobSlots();

      const refusal = await rejectionOf(convert([png]));
      await release();

      expect(refusal).toBeInstanceOf(ImageToolBusyError);
      expect(hasRunningWorker()).toBe(false);
      await expect(convert([png])).resolves.toBeInstanceOf(Buffer);
    });

    it.each([
      ['a damaged image', () => convert([createPngWithUnreadablePixels()])],
      ['a passed deadline', () => convert([png], NO_TIME)],
      ['success', () => convert([png, jpeg])],
    ])('gives its slot back after %s', async (_label, conversion) => {
      await conversion().catch(() => undefined);

      const release = holdImageJobSlots();
      await release();
    });
  });

  describe('worker slots', () => {
    it('refuses a conversion over the limit and runs it once a slot is free', async () => {
      const running = convert([png], ONE_AT_A_TIME);
      await workerStarted();

      expect(await failureReasonOf(convert([png], ONE_AT_A_TIME))).toBe('busy');
      await running;
      await expect(convert([png], ONE_AT_A_TIME)).resolves.toBeInstanceOf(Buffer);
    });

    it('shares its slots with PDF extraction', async () => {
      const slowPdf = createSlowPdf(30, 20);
      const extraction = extractPdfPages(new Uint8Array(slowPdf), { ...ONE_AT_A_TIME, maxPages: 20, deadlineMs: 5_000 });
      const settledExtraction = extraction.catch((rejection: unknown) => rejection);

      expect(await failureReasonOf(convert([png], ONE_AT_A_TIME))).toBe('busy');
      expect(await settledExtraction).toBeInstanceOf(PdfExtractionError);
    });

    it('frees its slot after a heap limit kill', async () => {
      expect(await failureReasonOf(convert([png], { ...ONE_AT_A_TIME, maxHeapMb: 8 }))).toBe('memory');

      const pdf = await convert([png], ONE_AT_A_TIME);
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    });
  });

  describe('worker lifetime', () => {
    it('keeps a worker alive only while a conversion runs', async () => {
      const running = convert([png, jpeg]);

      await workerStarted();
      await running;
      expect(hasRunningWorker()).toBe(false);
    });

    it.each([
      ['success', () => convert([png, jpeg])],
      ['an animated image', () => convert([createAnimatedPng()])],
      ['a damaged image', () => convert([createPngWithUnreadablePixels()])],
      ['a passed deadline', () => convert([png], NO_TIME)],
      ['a heap limit kill', () => convert([png], { ...LIMITS, maxHeapMb: 8 })],
    ])('has no worker left after %s', async (_label, conversion) => {
      await conversion().catch(() => undefined);

      expect(hasRunningWorker()).toBe(false);
    });
  });
});
