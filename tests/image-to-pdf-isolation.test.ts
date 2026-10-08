import os from 'os';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { ClientError } from '@/lib/convert/errors';
import { extractPdfPages, PdfExtractionError } from '@/lib/convert/pdf-extraction';
import { WorkerJobError, type WorkerLimits } from '@/lib/convert/worker-job';
import { convertImagesToPdf } from '@/lib/image/to-pdf';
import {
  createAnimatedPng,
  createPngThatHangsPdfLib,
  createPngWithUnreadablePixels,
  createSvgThatTakesMinutesToRender,
  readPdfPageImages,
} from './helpers/imageFiles';
import { createSlowPdf, trackEventLoopStall } from './helpers/slowPdf';

// Every conversion starts a worker thread and loads pdf-lib in it, which alone can take
// seconds while other suites compete for the CPU. A conversion that is meant to finish
// therefore gets a deadline no machine should reach, and each test more time than that.
const LIMITS: WorkerLimits = { deadlineMs: 30_000, maxHeapMb: 256, maxConcurrent: 2 };
const ONE_AT_A_TIME: WorkerLimits = { ...LIMITS, maxConcurrent: 1 };
// A conversion given this is refused as busy the moment it asks for a worker, so any
// other outcome was decided before pdf-lib saw the image.
const NO_WORKER_ALLOWED: WorkerLimits = { ...LIMITS, maxConcurrent: 0 };
jest.setTimeout(60_000);

const A4 = { width: 595.28, height: 841.89 };
const CORRUPTED = (imageNumber: number) => `Image ${imageNumber} is not a valid image or is corrupted.`;

let png: Buffer;
let jpeg: Buffer;
let hangingPng: Buffer;
let animatedPng: Buffer;

function flatImage(width: number, height: number, background = { r: 200, g: 30, b: 30 }) {
  return sharp({ create: { width, height, channels: 3, background } });
}

// Every pixel differs from its neighbours, so a lost, shifted or reordered sample shows.
function variedImage(width: number, height: number) {
  const samples = Buffer.alloc(width * height * 3);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = (index * 31 + (index >> 3) * 17) % 256;
  }
  return sharp(samples, { raw: { width, height, channels: 3 } });
}

function convert(imageBuffers: Buffer[], limits: WorkerLimits = LIMITS) {
  return convertImagesToPdf({ imageBuffers, limits });
}

// Only for a conversion of `hangingPng` whose kill is the point of the test.
function killedAfter(deadlineMs: number, limits: WorkerLimits = LIMITS) {
  return convert([hangingPng], { ...limits, deadlineMs });
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

// A conversion validates its images before it asks for a worker, so it holds a slot a
// moment after the call, not at once.
async function workerStarted(): Promise<void> {
  while (!hasRunningWorker()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function rawPixels(image: Buffer) {
  return sharp(image).raw().toBuffer();
}

beforeAll(async () => {
  png = await flatImage(100, 50).png().toBuffer();
  jpeg = await flatImage(80, 80, { r: 0, g: 160, b: 60 }).jpeg().toBuffer();
  hangingPng = createPngThatHangsPdfLib();
  animatedPng = createAnimatedPng();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('convertImagesToPdf — a PNG whose pixel data is not a zlib stream (#98)', () => {
  it('is refused as corrupted before pdf-lib sees it, with the event loop free', async () => {
    const unreadablePng = createPngWithUnreadablePixels();
    const order: string[] = [];

    const refusal = clientErrorOf(convert([unreadablePng], NO_WORKER_ALLOWED)).finally(() => order.push('refused'));
    await new Promise((resolve) => setImmediate(resolve));
    order.push('event loop turned');

    expect(unreadablePng).toHaveLength(72);
    expect(await refusal).toEqual({ status: 400, message: CORRUPTED(1) });
    expect(order).toEqual(['event loop turned', 'refused']);
  });

  it('names the image when it is not the first', async () => {
    const refusal = await clientErrorOf(convert([png, jpeg, createPngWithUnreadablePixels()], NO_WORKER_ALLOWED));

    expect(refusal.message).toBe(CORRUPTED(3));
  });

  it('is refused when its header claims a real photograph size', async () => {
    const refusal = await clientErrorOf(convert([createPngWithUnreadablePixels(4000, 3000)], NO_WORKER_ALLOWED));

    expect(refusal.message).toBe(CORRUPTED(1));
  });
});

describe('convertImagesToPdf — formats other than PNG and JPEG', () => {
  const UNSUPPORTED = 'Unsupported image format. Only PNG and JPEG are supported.';

  it('refuses an SVG that would take minutes to render without rendering it, and converts straight after', async () => {
    const slowSvg = Buffer.from(createSvgThatTakesMinutesToRender());

    const refusal = await clientErrorOf(convert([png, slowSvg], NO_WORKER_ALLOWED));
    const pdf = await convert([png]);

    expect(slowSvg).toHaveLength(233);
    expect(refusal).toEqual({ status: 400, message: UNSUPPORTED });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it.each([
    ['WebP', (image: sharp.Sharp) => image.webp()],
    ['GIF', (image: sharp.Sharp) => image.gif()],
    ['TIFF', (image: sharp.Sharp) => image.tiff()],
    ['AVIF', (image: sharp.Sharp) => image.avif()],
  ])('refuses %s by its content, before pdf-lib sees it', async (_label, encode) => {
    const encoded = await encode(flatImage(40, 40)).toBuffer();

    const refusal = await clientErrorOf(convert([encoded], NO_WORKER_ALLOWED));

    expect(refusal).toEqual({ status: 400, message: UNSUPPORTED });
  });

  it('refuses an unsupported image over the pixel limit as unsupported', async () => {
    const hugeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"/>');

    const refusal = await clientErrorOf(convert([hugeSvg], NO_WORKER_ALLOWED));

    expect(refusal.message).toBe(UNSUPPORTED);
  });

  it('refuses an animated PNG, which only pdf-lib can tell from a still one', async () => {
    const refusal = await clientErrorOf(convert([animatedPng]));

    expect(refusal).toEqual({ status: 400, message: UNSUPPORTED });
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
    // the image corrupted instead.
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

describe('convertImagesToPdf — unchanged output', () => {
  it('puts each image on its own A4 page, in order, scaled to fit and centred', async () => {
    const wide = await flatImage(100, 50).png().toBuffer();
    const tall = await flatImage(60, 240).jpeg().toBuffer();
    const small = await flatImage(20, 20).png().toBuffer();

    const pages = await readPdfPageImages(await convert([wide, tall, small]));

    expect(pages.map(({ pixelWidth, pixelHeight }) => [pixelWidth, pixelHeight])).toEqual([
      [100, 50],
      [60, 240],
      [20, 20],
    ]);
    for (const page of pages) {
      expect(page.pageWidth).toBeCloseTo(A4.width, 2);
      expect(page.pageHeight).toBeCloseTo(A4.height, 2);
    }
    const expectedPlacements = [
      { x: 0, y: (A4.height - A4.width / 2) / 2, width: A4.width, height: A4.width / 2 },
      { x: (A4.width - A4.height / 4) / 2, y: 0, width: A4.height / 4, height: A4.height },
      { x: 0, y: (A4.height - A4.width) / 2, width: A4.width, height: A4.width },
    ];
    pages.forEach(({ placement }, index) => {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(placement[key]).toBeCloseTo(expectedPlacements[index][key], 2);
      }
    });
  });

  it.each([
    ['baseline', {}],
    ['progressive', { progressive: true }],
  ])('stores a %s JPEG byte for byte', async (_label, jpegOptions) => {
    const photo = await variedImage(320, 200).jpeg(jpegOptions).toBuffer();

    const [page] = await readPdfPageImages(await convert([photo]));

    expect(page.filter).toBe('DCTDecode');
    expect(page.storedBytes.equals(photo)).toBe(true);
  });

  it('keeps every pixel of a PNG', async () => {
    const variedPng = await variedImage(120, 90).png().toBuffer();

    const [page] = await readPdfPageImages(await convert([variedPng]));

    expect(page.decodedBytes.equals(await rawPixels(variedPng))).toBe(true);
    expect(page.alpha).toBeUndefined();
  });

  it.each([
    ['palette', (image: sharp.Sharp) => image.png({ palette: true, colours: 16 })],
    ['interlaced', (image: sharp.Sharp) => image.png({ progressive: true })],
    ['greyscale', (image: sharp.Sharp) => image.greyscale().png()],
  ])('keeps every pixel of a %s PNG', async (_label, encode) => {
    const source = variedImage(64, 48);
    const encoded = await encode(source).toBuffer();

    const [page] = await readPdfPageImages(await convert([encoded]));

    expect(page.decodedBytes.equals(await sharp(encoded).toColourspace('srgb').removeAlpha().raw().toBuffer())).toBe(true);
  });

  it('keeps the transparency of a PNG', async () => {
    const width = 40;
    const height = 30;
    const rgba = Buffer.alloc(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      rgba.set([pixel % 256, (pixel * 7) % 256, 90, (pixel * 3) % 256], pixel * 4);
    }
    const transparentPng = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();

    const [page] = await readPdfPageImages(await convert([transparentPng]));

    expect(page.decodedBytes.equals(await sharp(transparentPng).removeAlpha().raw().toBuffer())).toBe(true);
    expect(page.alpha?.equals(await sharp(transparentPng).extractChannel('alpha').raw().toBuffer())).toBe(true);
  });

  it('leaves the caller its image buffers', async () => {
    const before = Buffer.from(png);

    await convert([png]);

    expect(png.equals(before)).toBe(true);
  });
});

describe('convertImagesToPdf — the worker as a backstop', () => {
  it('stops a conversion pdf-lib would never finish at the deadline, with the event loop free', async () => {
    const stopTracking = trackEventLoopStall();
    const startedAt = performance.now();

    const reason = await failureReasonOf(killedAfter(3_000));
    const elapsed = performance.now() - startedAt;
    const longestStall = stopTracking();

    expect(reason).toBe('deadline');
    expect(elapsed).toBeLessThan(30_000);
    // A blocked event loop stalls for the whole conversion, not for a fraction of it.
    expect(longestStall).toBeLessThan(elapsed / 2);
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

  describe('concurrency', () => {
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

      const conversion = killedAfter(5_000, ONE_AT_A_TIME).catch((rejection: unknown) => rejection);
      await workerStarted();
      const refusedExtraction = await rejectionOf(
        extractPdfPages(new Uint8Array(slowPdf), { ...ONE_AT_A_TIME, maxPages: 20 }),
      );

      expect(refusedExtraction).toMatchObject({ failure: { reason: 'busy' } });
      expect(await conversion).toMatchObject({ reason: 'deadline' });
    });

    it.each([
      ['an image only pdf-lib refuses', () => clientErrorOf(convert([animatedPng], ONE_AT_A_TIME))],
      ['a deadline kill', async () => expect(await failureReasonOf(killedAfter(1_000, ONE_AT_A_TIME))).toBe('deadline')],
      [
        'a heap limit kill',
        async () => expect(await failureReasonOf(convert([png], { ...ONE_AT_A_TIME, maxHeapMb: 8 }))).toBe('memory'),
      ],
    ])('frees its slot after %s', async (_label, failingConversion) => {
      await failingConversion();

      const pdf = await convert([png], ONE_AT_A_TIME);
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    });
  });

  describe('worker lifetime', () => {
    it('keeps a worker alive only while a conversion runs', async () => {
      const running = killedAfter(1_000).catch(() => undefined);

      await workerStarted();
      await running;
      expect(hasRunningWorker()).toBe(false);
    });

    it.each([
      ['success', () => convert([png, jpeg])],
      ['an image only pdf-lib refuses', () => convert([animatedPng])],
      ['a corrupted image', () => convert([createPngWithUnreadablePixels()])],
      ['a deadline kill', () => killedAfter(1_000)],
      ['a heap limit kill', () => convert([png], { ...LIMITS, maxHeapMb: 8 })],
    ])('has no worker left after %s', async (_label, conversion) => {
      await conversion().catch(() => undefined);

      expect(hasRunningWorker()).toBe(false);
    });
  });
});
