import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';
import { acceptImageToCompress, compressImage, compressionLevel, type CompressionLevel } from '@/lib/image/compress';
import {
  AUTHORED_SRGB,
  createAnimatedWebp,
  createPhotoJpeg,
  createSvgWithManyElements,
  displayP3Patch,
  firstPixel,
  flatImage,
  magicFormat,
  orientedPicture,
  photoLikePixels,
  pngColourType,
  rgbPixels,
  storedCorners,
  UPRIGHT_CORNERS,
} from './helpers/imageSamples';
import { createAnimatedPng, createSvgThatTakesMinutesToRender } from './helpers/imageFiles';

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

const LEVELS: CompressionLevel[] = ['low', 'medium', 'high'];
const UNSUPPORTED = 'Image 1 is not a supported image type. Only JPEG, PNG and WebP images are accepted.';
const DAMAGED = 'Image 1 is damaged or incomplete and could not be read.';

function wasGivenToSharp(upload: Buffer): boolean {
  return sharpCalls.mock.calls.some(([input]) => Buffer.isBuffer(input) && input.equals(upload));
}

async function compress(bytes: Buffer, level: CompressionLevel = 'medium'): Promise<Buffer> {
  return compressImage(await acceptImageToCompress(bytes, 1), level);
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

// Photographs saved with little or no compression, which every level can make smaller.
const LARGE_INPUTS: [string, () => Promise<Buffer>][] = [
  ['JPEG', () => createPhotoJpeg(320, 240, 100)],
  ['PNG', () => photoLikePixels(320, 240).png({ compressionLevel: 0 }).toBuffer()],
  ['WebP', () => photoLikePixels(320, 240).webp({ lossless: true }).toBuffer()],
];

function bitmapOfText(): Promise<Buffer> {
  const width = 400;
  const height = 120;
  const pixels = Buffer.alloc(width * height, 255);
  for (let y = 10; y < height - 10; y++) {
    for (let x = 10; x < width - 10; x++) {
      if ((x % 9 < 2 && y % 20 < 14) || (y % 20 === 6 && x % 31 < 20)) {
        pixels[y * width + x] = 0;
      }
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png({ palette: true, colours: 2 }).toBuffer();
}

// Images that are already as small as these encoders make them, or smaller.
const SMALL_INPUTS: [string, () => Promise<Buffer>][] = [
  ['a 1x1 PNG', () => flatImage(1, 1).png().toBuffer()],
  ['a 1x1 JPEG', () => flatImage(1, 1).jpeg().toBuffer()],
  ['a 1x1 WebP', () => flatImage(1, 1).webp().toBuffer()],
  ['a two-colour text bitmap', bitmapOfText],
  ['a flat palette PNG', () => flatImage(200, 200).png({ palette: true, colours: 4 }).toBuffer()],
  ['an already optimised JPEG', () => createPhotoJpeg(320, 240, 40)],
  ['an already optimised WebP', () => photoLikePixels(320, 240).webp({ quality: 30 }).toBuffer()],
];

describe('compressImage — the output is the format of the input', () => {
  it.each(LARGE_INPUTS)('compresses a %s into the same format at every level', async (format, createInput) => {
    const input = await createInput();

    for (const level of LEVELS) {
      const output = await compress(input, level);

      expect(magicFormat(output)).toBe(magicFormat(input));
      expect(magicFormat(output)).toBe(format.toLowerCase() === 'jpeg' ? 'jpeg' : format.toLowerCase());
      expect(output.length).toBeLessThan(input.length);
    }
  });

  it.each(LARGE_INPUTS)('gives a %s photo three different sizes, smallest at high', async (_format, createInput) => {
    const input = await createInput();

    const [low, medium, high] = await Promise.all(LEVELS.map(async (level) => (await compress(input, level)).length));

    expect(low).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(high);
  });
});

describe('compressImage — never larger', () => {
  it.each(SMALL_INPUTS)('returns %s unchanged when re-encoding does not make it smaller', async (_label, createInput) => {
    const input = await createInput();

    for (const level of LEVELS) {
      const output = await compress(input, level);

      expect(output.length).toBeLessThanOrEqual(input.length);
      if (output.length === input.length) {
        expect(output.equals(input)).toBe(true);
      }
    }
  });
});

describe('compressImage — PNG levels', () => {
  it('re-encodes losslessly at low, with and without transparency', async () => {
    for (const channels of [3, 4] as const) {
      const input = await photoLikePixels(200, 150)
        .ensureAlpha(channels === 4 ? 0.5 : 1)
        .toColourspace('srgb')
        .png({ compressionLevel: 0 })
        .toBuffer();
      const decode = (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer();

      const output = await compress(input, 'low');

      expect(pngColourType(output)).toBe(pngColourType(input));
      expect((await decode(output)).equals(await decode(input))).toBe(true);
    }
  });

  it.each(['medium', 'high'] as const)('reduces colours at %s and keeps transparency', async (level) => {
    const width = 200;
    const height = 150;
    const input = await photoLikePixels(width, height)
      .composite([
        {
          input: Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width / 2}" height="${height}" fill="#fff"/></svg>`),
          blend: 'dest-in',
        },
      ])
      .png({ compressionLevel: 0 })
      .toBuffer();

    const output = await compress(input, level);

    expect(pngColourType(output)).toBe(3);
    const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(10, 10)).toBe(255);
    expect(alphaAt(width - 10, 10)).toBe(0);
  });

  it('keeps a 16-bit PNG at 16 bits, pixel for pixel, at low', async () => {
    const input = await photoLikePixels(200, 150).toColourspace('rgb16').png({ compressionLevel: 0 }).toBuffer();
    expect(input[24]).toBe(16);
    const decode16 = (png: Buffer) => sharp(png).toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer();

    const output = await compress(input, 'low');

    expect(output[24]).toBe(16);
    expect((await decode16(output)).equals(await decode16(input))).toBe(true);
  });

  it('reduces a 16-bit PNG to an 8-bit palette at medium', async () => {
    const input = await photoLikePixels(200, 150).toColourspace('rgb16').png({ compressionLevel: 0 }).toBuffer();
    expect(input[24]).toBe(16);

    const output = await compress(input, 'medium');

    expect(pngColourType(output)).toBe(3);
    expect(output[24]).toBe(8);
  });
});

describe('compressImage — orientation, colour and metadata', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('turns a JPEG with EXIF orientation %d upright, with no tag left', async (orientation) => {
    const input = await orientedPicture(orientation).jpeg({ quality: 100 }).toBuffer();

    const output = await compress(input, 'medium');

    expect(output.length).toBeLessThan(input.length);
    expect(await storedCorners(output)).toEqual(UPRIGHT_CORNERS);
    expect((await sharp(output).metadata()).orientation).toBeUndefined();
  });

  it.each([
    ['PNG', (image: sharp.Sharp) => image.png({ compressionLevel: 0 })],
    ['WebP', (image: sharp.Sharp) => image.webp({ lossless: true })],
  ])('turns a %s with EXIF orientation 6 upright', async (_format, encode) => {
    const input = await encode(orientedPicture(6)).toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const output = await compress(input, 'medium');

    expect(output.length).toBeLessThan(input.length);
    expect(await storedCorners(output)).toEqual(UPRIGHT_CORNERS);
    expect((await sharp(output).metadata()).orientation).toBeUndefined();
  });

  // The reference is the sRGB colour the patch was authored in before lcms converted it
  // to Display P3 for the file (the matrix cross-check is in image-to-png.test.ts).
  it.each([
    ['JPEG', (image: sharp.Sharp) => image.jpeg({ quality: 100, chromaSubsampling: '4:4:4' }), 'medium', 3],
    ['PNG', (image: sharp.Sharp) => image.png({ compressionLevel: 0 }), 'low', 1],
    ['WebP', (image: sharp.Sharp) => image.webp({ lossless: true }), 'low', 3],
  ] as const)('converts a Display P3 %s to sRGB', async (_format, encode, level, tolerance) => {
    const input = await encode(displayP3Patch()).toBuffer();

    const output = await compress(input, level);

    expect(output.length).toBeLessThan(input.length);
    const shown = await firstPixel(output);
    shown.forEach((value, channel) => expect(Math.abs(value - AUTHORED_SRGB[channel])).toBeLessThanOrEqual(tolerance));
    expect((await sharp(output).metadata()).icc).toBeUndefined();
  });

  it('writes a CMYK JPEG out as an sRGB JPEG showing the same colours', async () => {
    const input = await photoLikePixels(320, 240).toColourspace('cmyk').jpeg({ quality: 100 }).toBuffer();
    expect((await sharp(input).metadata()).space).toBe('cmyk');

    const output = await compress(input, 'medium');

    expect(output.length).toBeLessThan(input.length);
    const metadata = await sharp(output).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.space).toBe('srgb');
    // Re-encoding this noisy picture at quality 80 alone moves it about 5 levels on
    // average; CMYK numbers read as if they were RGB would be off by tens.
    const shown = await rgbPixels(output);
    const managed = await rgbPixels(input);
    const meanDifference = shown.reduce((total, value, i) => total + Math.abs(value - managed[i]), 0) / shown.length;
    expect(meanDifference).toBeLessThan(10);
  });

  it('keeps a greyscale JPEG greyscale', async () => {
    const input = await sharp(await createPhotoJpeg(320, 240, 100)).toColourspace('b-w').jpeg({ quality: 100 }).toBuffer();

    const output = await compress(input, 'medium');

    expect(output.length).toBeLessThan(input.length);
    expect((await sharp(output).metadata()).channels).toBe(1);
  });

  it('strips EXIF, including GPS', async () => {
    const input = await photoLikePixels(320, 240)
      .withExif({ IFD0: { Copyright: 'Someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
      .jpeg({ quality: 100 })
      .toBuffer();

    const output = await compress(input, 'medium');

    expect(output.length).toBeLessThan(input.length);
    expect((await sharp(output).metadata()).exif).toBeUndefined();
  });
});

describe('acceptImageToCompress — what Compress Image takes', () => {
  it.each([
    ['GIF', () => flatImage().gif().toBuffer()],
    ['TIFF', () => flatImage().tiff().toBuffer()],
    ['AVIF', () => flatImage().avif().toBuffer()],
    ['an SVG with many elements', async () => createSvgWithManyElements()],
    ['an SVG that takes minutes to render', async () => Buffer.from(createSvgThatTakesMinutesToRender(8000))],
    ['a text file', async () => Buffer.from('Just some notes, saved with a .png extension.\n')],
  ])('refuses %s as unsupported without asking sharp about it', async (_label, createUpload) => {
    const upload = await createUpload();

    expect(await refusalOf(acceptImageToCompress(upload, 1))).toEqual({ status: 400, message: UNSUPPORTED });
    expect(wasGivenToSharp(upload)).toBe(false);
  });

  it.each([
    ['an animated WebP', createAnimatedWebp],
    ['an animated PNG', async () => createAnimatedPng()],
  ])('refuses %s, naming it, without asking sharp about it', async (_label, createUpload) => {
    const upload = await createUpload();

    expect(await refusalOf(acceptImageToCompress(upload, 2))).toEqual({
      status: 400,
      message: 'Image 2 is animated. Animated images are not supported.',
    });
    expect(wasGivenToSharp(upload)).toBe(false);
  });

  it.each([
    ['a PNG signature followed by garbage', async () => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('rubbish rubbish')])],
    ['a PNG cut off half-way', async () => {
      const png = await photoLikePixels(200, 150).png().toBuffer();
      return png.subarray(0, Math.floor(png.length / 2));
    }],
    ['a WebP cut off half-way', async () => {
      const webp = await photoLikePixels(200, 150).webp().toBuffer();
      return webp.subarray(0, Math.floor(webp.length / 2));
    }],
    ['a JPEG cut off half-way', async () => {
      const jpeg = await createPhotoJpeg();
      return jpeg.subarray(0, Math.floor(jpeg.length / 2));
    }],
  ])('refuses %s as damaged', async (_label, createUpload) => {
    expect(await refusalOf(compress(await createUpload()))).toEqual({ status: 400, message: DAMAGED });
  });
});

describe('compressionLevel', () => {
  it.each([
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    [null, 'medium'],
    ['', 'medium'],
    ['LOW', 'medium'],
    ['max', 'medium'],
    ['60', 'medium'],
  ])('reads %p as %s', (value, level) => {
    expect(compressionLevel(value)).toBe(level);
  });
});
