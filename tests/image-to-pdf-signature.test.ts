import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { ClientError } from '@/lib/convert/errors';
import type { WorkerLimits } from '@/lib/convert/worker-job';
import { convertImagesToPdf } from '@/lib/image/to-pdf';

// sharp itself, with every call recorded, so a test can tell whether the converter
// handed it a given upload at all.
jest.mock('sharp', () => {
  const actual = jest.requireActual('sharp');
  const recorded = Object.assign(
    jest.fn((...args: unknown[]) => actual(...args)),
    actual,
  );
  return { __esModule: true, default: recorded };
});

const sharpCalls = sharp as unknown as jest.Mock;

// Every conversion starts a worker thread and loads pdf-lib in it, which alone can take
// seconds while other suites compete for the CPU, so a conversion that is meant to
// finish gets a deadline no machine should reach, and each test more time than that.
const LIMITS: WorkerLimits = { deadlineMs: 30_000, maxHeapMb: 256, maxConcurrent: 2 };
jest.setTimeout(60_000);

const UNSUPPORTED = 'Unsupported image format. Only PNG and JPEG are supported.';

function flatImage() {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } } });
}

// librsvg parses a whole SVG document to report its size, so even reading the "header"
// of one like this costs seconds and hundreds of megabytes at 300,000 elements.
function createSvgWithManyElements(elementCount = 2_000): Buffer {
  const rects = Array.from(
    { length: elementCount },
    (_, index) => `<rect x="${index % 2000}" y="${(index * 7) % 2000}" width="5" height="5" fill="#${(index % 4096).toString(16).padStart(3, '0')}"/>`,
  );
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000">${rects.join('')}</svg>`,
  );
}

function wasGivenToSharp(upload: Buffer): boolean {
  return sharpCalls.mock.calls.some(([input]) => input === upload);
}

async function refusalOf(upload: Buffer) {
  const error = await convertImagesToPdf({ imageBuffers: [upload], limits: LIMITS }).then(
    () => {
      throw new Error('expected the conversion to be rejected');
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(ClientError);
  return { status: (error as ClientError).status, message: (error as ClientError).message };
}

describe('convertImagesToPdf — files that do not start as a PNG or a JPEG', () => {
  it('refuses an SVG with many elements without asking sharp about it', async () => {
    const svg = createSvgWithManyElements();

    const refusal = await refusalOf(svg);

    expect(refusal).toEqual({ status: 400, message: UNSUPPORTED });
    expect(wasGivenToSharp(svg)).toBe(false);
  });

  it.each([
    ['WebP', () => flatImage().webp().toBuffer()],
    ['GIF', () => flatImage().gif().toBuffer()],
    ['TIFF', () => flatImage().tiff().toBuffer()],
    ['AVIF', () => flatImage().avif().toBuffer()],
    ['a text file', async () => Buffer.from('Just some notes, saved with the wrong extension.\n')],
    ['a file shorter than a signature', async () => Buffer.from([0xff, 0xd8])],
  ])('refuses %s without asking sharp about it', async (_label, createUpload) => {
    const upload = await createUpload();

    const refusal = await refusalOf(upload);

    expect(refusal).toEqual({ status: 400, message: UNSUPPORTED });
    expect(wasGivenToSharp(upload)).toBe(false);
  });

  it('refuses the whole request when a later file is not a PNG or a JPEG', async () => {
    const png = await flatImage().png().toBuffer();
    const svg = createSvgWithManyElements();

    const error = await convertImagesToPdf({ imageBuffers: [png, svg], limits: LIMITS }).catch(
      (rejection: unknown) => rejection,
    );

    expect(error).toMatchObject({ status: 400, message: UNSUPPORTED });
    expect(wasGivenToSharp(svg)).toBe(false);
  });
});

describe('convertImagesToPdf — files that do start as a PNG or a JPEG', () => {
  it.each([
    ['a PNG', () => flatImage().png().toBuffer()],
    ['a JPEG', () => flatImage().jpeg().toBuffer()],
  ])('hands %s to sharp and converts it', async (_label, createUpload) => {
    const upload = await createUpload();

    const pdf = await convertImagesToPdf({ imageBuffers: [upload], limits: LIMITS });

    expect(wasGivenToSharp(upload)).toBe(true);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it.each([
    ['a PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['a JPEG start', Buffer.from([0xff, 0xd8, 0xff])],
  ])('calls a file with %s and garbage after it corrupted, not unsupported', async (_label, signature) => {
    const upload = Buffer.concat([signature, Buffer.from(' then total nonsense that is not a real image')]);

    const refusal = await refusalOf(upload);

    expect(refusal).toEqual({ status: 400, message: 'Image 1 is not a valid image or is corrupted.' });
  });

  it('still reports an empty file as empty', async () => {
    expect(await refusalOf(Buffer.alloc(0))).toEqual({ status: 400, message: 'Image 1 is empty.' });
  });
});
