import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { ClientError } from '@/lib/convert/errors';
import type { WorkerLimits } from '@/lib/convert/worker-job';
import { convertImagesToPdf } from '@/lib/image/to-pdf';
import { createBmp } from './helpers/bmpFiles';
import { createAnimatedPng } from './helpers/imageFiles';
import { createAnimatedWebp, createSvgWithManyElements } from './helpers/imageSamples';

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

const UNSUPPORTED = 'Image 1 is not a supported image type. Only JPEG, PNG, WebP, GIF, TIFF, AVIF and BMP images are accepted.';
const ANIMATED = 'Image 1 is animated. Animated images are not supported.';

function flatImage() {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } } });
}

// An ISO media file's opening `ftyp` box with the given brands and nothing after it.
function fileTypeBox(majorBrand: string, compatibleBrands: string[]): Buffer {
  const size = 16 + 4 * compatibleBrands.length;
  const box = Buffer.alloc(size);
  box.writeUInt32BE(size, 0);
  box.write(`ftyp${majorBrand}`, 4, 'latin1');
  compatibleBrands.forEach((brand, index) => box.write(brand, 16 + 4 * index, 'latin1'));
  return Buffer.concat([box, Buffer.from('then the rest of the file')]);
}

async function twoFrames(): Promise<Buffer[]> {
  return Promise.all(
    [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 0, b: 255 },
    ].map((background) => sharp({ create: { width: 16, height: 16, channels: 3, background } }).png().toBuffer()),
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

describe('convertImagesToPdf — files of a type it does not accept', () => {
  it.each([
    ['an SVG with many elements', async () => createSvgWithManyElements()],
    ['a HEIC image', async () => fileTypeBox('heic', ['mif1', 'heic'])],
    ['an ICO icon', async () => Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), await flatImage().png().toBuffer()])],
    ['a BMP compressed as JPEG', async () => {
      const bmp = createBmp({ width: 4, height: 4, pixel: () => [1, 2, 3, 255], bitsPerPixel: 24 });
      bmp.writeUInt32LE(4, 30);
      return bmp;
    }],
    ['a text file', async () => Buffer.from('Just some notes, saved with the wrong extension.\n')],
    ['a file shorter than a signature', async () => Buffer.from([0xff, 0xd8])],
  ])('refuses %s without asking sharp about it', async (_label, createUpload) => {
    const upload = await createUpload();

    const refusal = await refusalOf(upload);

    expect(refusal).toEqual({ status: 400, message: UNSUPPORTED });
    expect(wasGivenToSharp(upload)).toBe(false);
  });

  it('refuses the whole request when a later file is not accepted', async () => {
    const png = await flatImage().png().toBuffer();
    const svg = createSvgWithManyElements();

    const error = await convertImagesToPdf({ imageBuffers: [png, svg], limits: LIMITS }).catch(
      (rejection: unknown) => rejection,
    );

    expect(error).toMatchObject({
      status: 400,
      message: 'Image 2 is not a supported image type. Only JPEG, PNG, WebP, GIF, TIFF, AVIF and BMP images are accepted.',
    });
    expect(wasGivenToSharp(svg)).toBe(false);
  });
});

describe('convertImagesToPdf — images of more than one frame or page', () => {
  it.each([
    ['an animated WebP', createAnimatedWebp],
    ['an animated PNG', async () => createAnimatedPng()],
    ['an AVIF image sequence', async () => fileTypeBox('avis', ['avif', 'avis', 'msf1', 'miaf'])],
  ])('refuses %s as animated without asking sharp about it', async (_label, createUpload) => {
    const upload = await createUpload();

    expect(await refusalOf(upload)).toEqual({ status: 400, message: ANIMATED });
    expect(wasGivenToSharp(upload)).toBe(false);
  });

  it('refuses an animated GIF from the frame count in its header', async () => {
    const upload = await sharp(await twoFrames(), { join: { animated: true } }).gif().toBuffer();

    expect(await refusalOf(upload)).toEqual({ status: 400, message: ANIMATED });
  });

  it('refuses a TIFF of several pages without asking sharp about it', async () => {
    const upload = await sharp(await twoFrames(), { join: { animated: true } }).tiff().toBuffer();

    expect(await refusalOf(upload)).toEqual({
      status: 400,
      message: 'Image 1 has more than one page. Images with several pages are not supported.',
    });
    expect(wasGivenToSharp(upload)).toBe(false);
  });

  it('converts a still GIF padded with thousands of empty extension blocks', async () => {
    const still = await flatImage().gif().toBuffer();
    const emptyExtension = Buffer.from([0x21, 0xfe, 0x00]);
    const screenEnd = 13 + 3 * 2 ** ((still[10] & 0x07) + 1);
    const padded = Buffer.concat([still.subarray(0, screenEnd), Buffer.concat(Array(100_000).fill(emptyExtension)), still.subarray(screenEnd)]);

    const pdf = await convertImagesToPdf({ imageBuffers: [padded], limits: LIMITS });

    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
});

describe('convertImagesToPdf — files of a type it accepts', () => {
  it.each([
    ['a PNG', () => flatImage().png().toBuffer()],
    ['a JPEG', () => flatImage().jpeg().toBuffer()],
    ['a WebP', () => flatImage().webp().toBuffer()],
    ['a GIF', () => flatImage().gif().toBuffer()],
    ['a TIFF', () => flatImage().tiff().toBuffer()],
    ['an AVIF', () => flatImage().avif().toBuffer()],
  ])('hands %s to sharp and converts it', async (_label, createUpload) => {
    const upload = await createUpload();

    const pdf = await convertImagesToPdf({ imageBuffers: [upload], limits: LIMITS });

    expect(wasGivenToSharp(upload)).toBe(true);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it('converts a BMP, which sharp cannot read, without handing sharp the file', async () => {
    const upload = createBmp({ width: 40, height: 40, pixel: () => [200, 30, 30, 255], bitsPerPixel: 24 });

    const pdf = await convertImagesToPdf({ imageBuffers: [upload], limits: LIMITS });

    expect(wasGivenToSharp(upload)).toBe(false);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it.each([
    ['a PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['a JPEG start', Buffer.from([0xff, 0xd8, 0xff])],
    ['a GIF signature', Buffer.from('GIF89a', 'latin1')],
    ['a TIFF header', Buffer.from([0x49, 0x49, 0x2a, 0x00])],
  ])('calls a file with %s and garbage after it damaged, not unsupported', async (_label, signature) => {
    const upload = Buffer.concat([signature, Buffer.from(' then total nonsense that is not a real image')]);

    const refusal = await refusalOf(upload);

    expect(refusal).toEqual({ status: 400, message: 'Image 1 is damaged or incomplete and could not be read.' });
  });

  it('still reports an empty file as empty', async () => {
    expect(await refusalOf(Buffer.alloc(0))).toEqual({ status: 400, message: 'Image 1 is empty.' });
  });
});
