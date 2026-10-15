import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';
import { acceptJpeg, convertJpegToPng } from '@/lib/image/to-png';
import {
  AUTHORED_SRGB,
  createGradientJpeg,
  createPhotoJpeg,
  createSvgWithManyElements,
  displayP3Patch,
  displayP3ToSrgb,
  firstPixel,
  flatImage,
  magicFormat,
  orientedPicture,
  pngColourType,
  pngHasChunk,
  rgbPixels,
  storedCorners,
  storedFirstPixel,
  UPRIGHT_CORNERS,
} from './helpers/imageSamples';
import { createSvgThatTakesMinutesToRender } from './helpers/imageFiles';

// sharp itself, with every call recorded, so a test can tell whether an upload was
// handed to it at all.
jest.mock('sharp', () => {
  const actual = jest.requireActual('sharp');
  const recorded = Object.assign(
    jest.fn((...args: unknown[]) => actual(...args)),
    actual,
  );
  return { __esModule: true, default: recorded };
});

const sharpCalls = sharp as unknown as jest.Mock;
jest.setTimeout(60_000);

const UNSUPPORTED = 'Image 1 is not a supported image type. Only JPEG images are accepted.';
const DAMAGED = 'Image 1 is damaged or incomplete and could not be read.';

function wasGivenToSharp(upload: Buffer): boolean {
  return sharpCalls.mock.calls.some(([input]) => Buffer.isBuffer(input) && input.equals(upload));
}

async function convert(jpeg: Buffer): Promise<Buffer> {
  return convertJpegToPng(await acceptJpeg(jpeg, 1));
}

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error('expected the image to be refused');
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(ClientError);
  return { status: (error as ClientError).status, message: (error as ClientError).message };
}

// A minimal valid 1x1 24-bit BMP, which sharp cannot decode.
function createBmp(): Buffer {
  const bmp = Buffer.alloc(58);
  bmp.write('BM', 0, 'latin1');
  bmp.writeUInt32LE(58, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(1, 18);
  bmp.writeInt32LE(1, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(4, 34);
  return bmp;
}

beforeEach(() => {
  sharpCalls.mockClear();
});

describe('convertJpegToPng — lossless true-colour output', () => {
  it.each([
    ['a photo-like JPEG', () => createPhotoJpeg()],
    ['a smooth gradient', () => createGradientJpeg()],
  ])('turns %s into a true-colour PNG whose pixels equal the decoded JPEG', async (_label, createJpeg) => {
    const jpeg = await createJpeg();

    const png = await convert(jpeg);

    expect(magicFormat(png)).toBe('png');
    expect(pngColourType(png)).toBe(2);
    expect(png[24]).toBe(8);
    expect(pngHasChunk(png, 'PLTE')).toBe(false);
    expect((await rgbPixels(png)).equals(await rgbPixels(jpeg))).toBe(true);
  });

  it('keeps a greyscale JPEG grey, pixel for pixel', async () => {
    const jpeg = await sharp(await createPhotoJpeg()).toColourspace('b-w').jpeg().toBuffer();
    expect((await sharp(jpeg).metadata()).channels).toBe(1);

    const png = await convert(jpeg);

    expect(pngColourType(png)).toBe(0);
    const decodedJpeg = await sharp(jpeg).raw().toBuffer();
    expect((await sharp(png).raw().toBuffer()).equals(decodedJpeg)).toBe(true);
  });

  it('converts a CMYK JPEG to an sRGB PNG', async () => {
    const jpeg = await flatImage(32, 32, { r: 200, g: 30, b: 30 }).toColourspace('cmyk').jpeg({ quality: 100 }).toBuffer();
    expect((await sharp(jpeg).metadata()).space).toBe('cmyk');

    const png = await convert(jpeg);

    expect(pngColourType(png)).toBe(2);
    const [r, g, b] = await firstPixel(png);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });
});

describe('convertJpegToPng — orientation, colour and metadata', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('comes out upright from EXIF orientation %d, with no tag left', async (orientation) => {
    const jpeg = await orientedPicture(orientation).jpeg({ quality: 95 }).toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(orientation);

    const png = await convert(jpeg);

    expect(await storedCorners(png)).toEqual(UPRIGHT_CORNERS);
    const metadata = await sharp(png).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  // The reference is the sRGB colour the patch was authored in before lcms converted it
  // to Display P3 for the file, cross-checked against the published P3 and sRGB
  // matrices applied to the numbers actually stored in the file.
  it('converts a Display P3 JPEG to the sRGB colours a colour-managed viewer shows', async () => {
    const jpeg = await displayP3Patch().jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
    const stored = await storedFirstPixel(jpeg);
    expect(Math.max(...stored.map((value, channel) => Math.abs(value - AUTHORED_SRGB[channel])))).toBeGreaterThan(10);

    const png = await convert(jpeg);

    const shown = await firstPixel(png);
    const byMatrix = displayP3ToSrgb(stored);
    shown.forEach((value, channel) => {
      expect(Math.abs(value - AUTHORED_SRGB[channel])).toBeLessThanOrEqual(2);
      expect(Math.abs(value - byMatrix[channel])).toBeLessThanOrEqual(2);
    });
    expect((await sharp(png).metadata()).icc).toBeUndefined();
  });

  it('strips EXIF, including GPS, from the output', async () => {
    const jpeg = await flatImage()
      .withExif({ IFD0: { Copyright: 'Someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const png = await convert(jpeg);

    expect((await sharp(png).metadata()).exif).toBeUndefined();
    expect(pngHasChunk(png, 'eXIf')).toBe(false);
  });
});

describe('acceptJpeg — what JPEG to PNG takes', () => {
  it.each([
    ['PNG', () => flatImage().png().toBuffer()],
    ['WebP', () => flatImage().webp().toBuffer()],
    ['GIF', () => flatImage().gif().toBuffer()],
    ['TIFF', () => flatImage().tiff().toBuffer()],
    ['BMP', async () => createBmp()],
    ['an SVG with many elements', async () => createSvgWithManyElements()],
    ['an SVG that takes minutes to render', async () => Buffer.from(createSvgThatTakesMinutesToRender())],
    ['a text file', async () => Buffer.from('Just some notes, saved with a .jpg extension.\n')],
    ['a file shorter than a JPEG start', async () => Buffer.from([0xff, 0xd8])],
  ])('refuses %s as unsupported without asking sharp about it', async (_label, createUpload) => {
    const upload = await createUpload();

    expect(await refusalOf(acceptJpeg(upload, 1))).toEqual({ status: 400, message: UNSUPPORTED });
    expect(wasGivenToSharp(upload)).toBe(false);
  });

  it('names the image it refuses', async () => {
    const png = await flatImage().png().toBuffer();

    expect((await refusalOf(acceptJpeg(png, 3))).message).toBe(
      'Image 3 is not a supported image type. Only JPEG images are accepted.',
    );
  });

  it('refuses an empty file as empty', async () => {
    expect(await refusalOf(acceptJpeg(Buffer.alloc(0), 2))).toEqual({ status: 400, message: 'Image 2 is empty.' });
  });

  it('refuses a JPEG start followed by garbage as damaged', async () => {
    const upload = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(' rubbish rubbish rubbish')]);

    expect(await refusalOf(convert(upload))).toEqual({ status: 400, message: DAMAGED });
  });

  it('refuses a JPEG cut off half-way as damaged', async () => {
    const photo = await createPhotoJpeg();

    expect(await refusalOf(convert(photo.subarray(0, Math.floor(photo.length / 2))))).toEqual({
      status: 400,
      message: DAMAGED,
    });
  });
});
