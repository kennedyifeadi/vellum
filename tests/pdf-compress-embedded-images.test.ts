import zlib from 'zlib';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { compressPdf } from '../lib/pdf/compress';
import { MAX_IMAGE_PIXELS } from '../lib/convert/image-limits';

// sharp itself, with every call recorded, so a test can tell whether the compressor
// handed it a given image stream at all.
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

const WIDTH = 240;
const HEIGHT = 160;

// The document info is stripped on compression, so a long title guarantees the output
// is smaller than the input whatever happens to the image.
const LONG_TITLE = 'Quarterly report '.repeat(200);

function noisyPixels(): Buffer {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  let seed = 0x1234567;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = (seed >> 8) & 0xff;
  }
  return pixels;
}

function svgImage(): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">` +
      `<rect width="${WIDTH}" height="${HEIGHT}" fill="#3a7bd5"/></svg>`,
    'utf8',
  );
}

function pngImage(): Promise<Buffer> {
  return sharp(noisyPixels(), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}

function jpegImage(): Promise<Buffer> {
  return sharp(noisyPixels(), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

async function pdfWithDctImage(imageBytes: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(LONG_TITLE);
  const ctx = doc.context;
  const dict = ctx.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: WIDTH,
    Height: HEIGHT,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'DCTDecode',
  });
  const imageRef = ctx.register(PDFRawStream.of(dict, imageBytes));

  const page = doc.addPage([WIDTH, HEIGHT]);
  page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Im0: imageRef } }));
  const content = `q ${WIDTH} 0 0 ${HEIGHT} 0 0 cm /Im0 Do Q`;
  page.node.set(PDFName.of('Contents'), ctx.register(PDFRawStream.of(ctx.obj({}), Buffer.from(content, 'latin1'))));

  return Buffer.from(await doc.save());
}

async function imageStream(pdfBuffer: Buffer): Promise<PDFRawStream> {
  const doc = await PDFDocument.load(pdfBuffer);
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') {
      return obj;
    }
  }
  throw new Error('no image XObject found in PDF');
}

function inputsGivenToSharp(): unknown[] {
  return sharpCalls.mock.calls.map(([input]) => input);
}

function wasGivenToSharp(bytes: Buffer): boolean {
  return inputsGivenToSharp().some((input) => Buffer.isBuffer(input) && input.equals(bytes));
}

describe('compressPdf with images stored as DCTDecode', () => {
  beforeEach(() => {
    sharpCalls.mockClear();
  });

  it.each([
    ['an SVG', async () => svgImage()],
    ['a PNG', pngImage],
  ])('never gives %s to sharp, and leaves it untouched in a compressed PDF', async (_name, makeImage) => {
    const image = await makeImage();
    const pdfBuffer = await pdfWithDctImage(image);
    sharpCalls.mockClear();

    const result = await compressPdf({ pdfBuffer, level: 'high' });

    expect(wasGivenToSharp(image)).toBe(false);
    expect(result.compressedSize).toBeLessThan(result.originalSize);
    const stream = await imageStream(result.buffer);
    expect(Buffer.from(stream.contents).equals(image)).toBe(true);
  });

  it('re-encodes a real JPEG, giving it to sharp with the pixel limit', async () => {
    const image = await jpegImage();
    const pdfBuffer = await pdfWithDctImage(image);
    sharpCalls.mockClear();

    const result = await compressPdf({ pdfBuffer, level: 'high' });

    const call = sharpCalls.mock.calls.find(([input]) => Buffer.isBuffer(input) && input.equals(image));
    expect(call?.[1]).toEqual(expect.objectContaining({ limitInputPixels: MAX_IMAGE_PIXELS }));
    const stream = await imageStream(result.buffer);
    expect(stream.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
    expect(stream.contents.length).toBeLessThan(image.length);
    expect((await sharp(Buffer.from(stream.contents)).metadata()).format).toBe('jpeg');
  });

  it('gives raw Flate pixels to sharp with the pixel limit', async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const dict = ctx.obj({
      Type: 'XObject',
      Subtype: 'Image',
      Width: WIDTH,
      Height: HEIGHT,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'FlateDecode',
    });
    const imageRef = ctx.register(PDFRawStream.of(dict, zlib.deflateSync(noisyPixels())));
    doc.addPage([WIDTH, HEIGHT]).node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Im0: imageRef } }));
    const pdfBuffer = Buffer.from(await doc.save());
    sharpCalls.mockClear();

    await compressPdf({ pdfBuffer, level: 'high' });

    const rawCalls = sharpCalls.mock.calls.filter(([, options]) => options?.raw);
    expect(rawCalls.length).toBeGreaterThan(0);
    for (const [, options] of rawCalls) {
      expect(options).toEqual(expect.objectContaining({ limitInputPixels: MAX_IMAGE_PIXELS }));
    }
  });
});
