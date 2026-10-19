import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';
import type { WorkerLimits } from '@/lib/convert/worker-job';
import { convertImagesToPdf } from '@/lib/image/to-pdf';
import { createBmp, expectedBmpPixels, type BmpOptions } from './helpers/bmpFiles';
import { readPdfPageImages, type PdfPageImage } from './helpers/imageFiles';
import {
  AUTHORED_SRGB,
  createPhotoJpeg,
  displayP3Patch,
  displayP3ToSrgb,
  firstPixel,
  flatImage,
  orientedPicture,
  photoLikePixels,
  storedCorners,
  storedFirstPixel,
  UPRIGHT_CORNERS,
} from './helpers/imageSamples';
import { renderPdfPages, type RenderedPage } from './helpers/renderPdf';

// Every conversion starts a worker thread and loads pdf-lib in it, which alone can take
// seconds while other suites compete for the CPU, so a conversion that is meant to
// finish gets a deadline no machine should reach, and each test more time than that.
const LIMITS: WorkerLimits = { deadlineMs: 60_000, maxHeapMb: 256, maxConcurrent: 2 };
// Refused as busy the moment it asks for a worker, so any other outcome was decided
// before pdf-lib saw the images.
const NO_WORKER_ALLOWED: WorkerLimits = { ...LIMITS, maxConcurrent: 0 };
jest.setTimeout(120_000);

const A4 = { short: 595.28, long: 841.89 };
const MARGIN = 36;
const DAMAGED = 'Image 1 is damaged or incomplete and could not be read.';
// Two units either way covers pdf.js drawing an image onto its canvas.
const RENDER_TOLERANCE = 2;

function convert(imageBuffers: Buffer[], limits: WorkerLimits = LIMITS) {
  return convertImagesToPdf({ imageBuffers, limits });
}

async function onlyPage(image: Buffer): Promise<PdfPageImage> {
  const [page] = await readPdfPageImages(await convert([image]));
  return page;
}

async function refusalOf(conversion: Promise<unknown>) {
  const error = await conversion.then(
    () => {
      throw new Error('expected the conversion to be refused');
    },
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(ClientError);
  return { status: (error as ClientError).status, message: (error as ClientError).message };
}

// Each page's image as a viewer draws it, cropped to where the page places it, as a PNG.
async function drawnImages(pdf: Buffer, scale = 4): Promise<Buffer[]> {
  const images = await readPdfPageImages(pdf);
  const pages = await renderPdfPages(pdf, scale);
  return Promise.all(
    pages.map((page, index) => {
      const { pageHeight, placement } = images[index];
      return sharp(page.rgba, { raw: { width: page.width, height: page.height, channels: 4 } })
        .extract({
          left: Math.round(placement.x * scale),
          top: Math.round((pageHeight - placement.y - placement.height) * scale),
          width: Math.round(placement.width * scale),
          height: Math.round(placement.height * scale),
        })
        .png()
        .toBuffer();
    }),
  );
}

async function shownCorners(pdf: Buffer): Promise<string[][]> {
  return Promise.all((await drawnImages(pdf)).map(async (image) => (await storedCorners(image)).corners));
}

function colourInside(page: RenderedPage, image: PdfPageImage, fx: number, fy: number, scale: number) {
  const { x, y, width, height } = image.placement;
  return page.colourAt((x + width * fx) * scale, (image.pageHeight - y - height + height * fy) * scale);
}

function expectWithin(actual: number[], expected: number[], tolerance: number) {
  actual.forEach((value, channel) => expect(Math.abs(value - expected[channel])).toBeLessThanOrEqual(tolerance));
}

describe('convertImagesToPdf — EXIF orientation', () => {
  const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8];
  const UPRIGHT_ON_EVERY_PAGE = ORIENTATIONS.map(() => UPRIGHT_CORNERS.corners);

  it('shows a JPEG tagged with each orientation upright, on a landscape page, its bytes untouched', async () => {
    const jpegs = await Promise.all(ORIENTATIONS.map((orientation) => orientedPicture(orientation).jpeg({ quality: 95 }).toBuffer()));

    const pdf = await convert(jpegs);
    const pages = await readPdfPageImages(pdf);

    expect(await shownCorners(pdf)).toEqual(UPRIGHT_ON_EVERY_PAGE);
    pages.forEach((page, index) => {
      expect(page.pageWidth).toBeCloseTo(A4.long, 2);
      expect(page.filter).toBe('DCTDecode');
      expect(page.storedBytes.equals(jpegs[index])).toBe(true);
    });
  });

  it.each([
    ['PNG', (image: sharp.Sharp) => image.png()],
    ['WebP', (image: sharp.Sharp) => image.webp({ lossless: true })],
    ['TIFF', (image: sharp.Sharp) => image.tiff()],
  ])('shows a %s tagged with each orientation upright', async (_label, encode) => {
    const encoded = await Promise.all(ORIENTATIONS.map((orientation) => encode(orientedPicture(orientation)).toBuffer()));
    const tags = await Promise.all(encoded.map(async (image) => (await sharp(image).metadata()).orientation));
    expect(tags).toEqual(ORIENTATIONS);

    expect(await shownCorners(await convert(encoded))).toEqual(UPRIGHT_ON_EVERY_PAGE);
  });
});

describe('convertImagesToPdf — page layout', () => {
  it('chooses a portrait page for a tall or square image and a landscape page for a wide one', async () => {
    const pages = await readPdfPageImages(
      await convert([
        await flatImage(40, 60).png().toBuffer(),
        await flatImage(50, 50).png().toBuffer(),
        await flatImage(60, 40).png().toBuffer(),
      ]),
    );

    expect(pages.map(({ pageWidth, pageHeight }) => [pageWidth, pageHeight])).toEqual([
      [A4.short, A4.long],
      [A4.short, A4.long],
      [A4.long, A4.short],
    ]);
  });

  it('chooses the page from the picture as shown, not as stored', async () => {
    const sideways = await orientedPicture(6).jpeg().toBuffer();

    const page = await onlyPage(sideways);

    expect((await sharp(sideways).metadata()).height).toBeGreaterThan((await sharp(sideways).metadata()).width!);
    expect([page.pageWidth, page.pageHeight]).toEqual([A4.long, A4.short]);
    expect(page.placement.width).toBeGreaterThan(page.placement.height);
  });

  it('draws a 16x16 icon at its real size at 96 dpi, centred, not enlarged', async () => {
    const icon = await photoLikePixels(16, 16).png().toBuffer();

    const page = await onlyPage(icon);

    expect(page.placement.width).toBeCloseTo(12, 5);
    expect(page.placement.height).toBeCloseTo(12, 5);
    expect(page.placement.x).toBeCloseTo((A4.short - 12) / 2, 5);
    expect(page.placement.y).toBeCloseTo((A4.long - 12) / 2, 5);
  });

  it('draws an image at the physical size its 300 dpi metadata gives', async () => {
    const scan = await flatImage(600, 300).withMetadata({ density: 300 }).png().toBuffer();

    const page = await onlyPage(scan);

    expect(page.placement.width).toBeCloseTo(144, 5);
    expect(page.placement.height).toBeCloseTo(72, 5);
  });

  it.each([
    ['a resolution below 72 dpi', 10],
    ['a resolution above 1200 dpi', 5000],
  ])('treats %s as 96 dpi', async (_label, density) => {
    const image = await flatImage(96, 48).withMetadata({ density }).png().toBuffer();

    const page = await onlyPage(image);

    expect(page.placement.width).toBeCloseTo(72, 5);
  });

  it('scales a large image down to fit inside the margins, centred, keeping its shape', async () => {
    const large = await flatImage(4000, 3000).jpeg().toBuffer();

    const page = await onlyPage(large);
    const { x, y, width, height } = page.placement;

    expect([page.pageWidth, page.pageHeight]).toEqual([A4.long, A4.short]);
    expect(y).toBeCloseTo(MARGIN, 5);
    expect(height).toBeCloseTo(A4.short - 2 * MARGIN, 5);
    expect(width / height).toBeCloseTo(4000 / 3000, 5);
    expect(x).toBeCloseTo((A4.long - width) / 2, 5);
  });

  it('keeps a long panorama inside the side margins', async () => {
    const panorama = await flatImage(6000, 600).jpeg().toBuffer();

    const { x, width } = (await onlyPage(panorama)).placement;

    expect(x).toBeCloseTo(MARGIN, 5);
    expect(width).toBeCloseTo(A4.long - 2 * MARGIN, 5);
  });

  it('puts each image on its own page, in upload order', async () => {
    const colours = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
    ];
    const images = await Promise.all(colours.map((colour) => flatImage(30, 30, colour).png().toBuffer()));

    const pages = await readPdfPageImages(await convert(images));

    expect(pages.map((page) => [...page.decodedBytes.subarray(0, 3)])).toEqual(colours.map(({ r, g, b }) => [r, g, b]));
  });
});

describe('convertImagesToPdf — formats', () => {
  async function expectPixelsKept(encoded: Buffer) {
    const page = await onlyPage(encoded);
    const decoded = await sharp(encoded).removeAlpha().raw().toBuffer();

    expect([page.pixelWidth, page.pixelHeight]).toEqual([64, 48]);
    expect(page.decodedBytes.equals(decoded)).toBe(true);
  }

  it.each([
    ['WebP (lossless)', (image: sharp.Sharp) => image.webp({ lossless: true })],
    ['WebP (lossy)', (image: sharp.Sharp) => image.webp({ quality: 80 })],
    ['TIFF', (image: sharp.Sharp) => image.tiff({ compression: 'lzw' })],
    ['AVIF', (image: sharp.Sharp) => image.avif({ quality: 70 })],
  ])('converts %s with the pixels its decoder gives', async (_label, encode) => {
    await expectPixelsKept(await encode(photoLikePixels(64, 48)).toBuffer());
  });

  it('converts a GIF with its palette colours and its transparency', async () => {
    const rgba = Buffer.alloc(64 * 48 * 4);
    for (let pixel = 0; pixel < 64 * 48; pixel++) {
      rgba.set(pixel % 64 < 32 ? [200, 30, 30, 255] : [30, 30, 200, 0], pixel * 4);
    }
    const gif = await sharp(rgba, { raw: { width: 64, height: 48, channels: 4 } }).gif().toBuffer();

    const page = await onlyPage(gif);

    expect(page.decodedBytes.equals(await sharp(gif).removeAlpha().raw().toBuffer())).toBe(true);
    expect(page.alpha?.equals(await sharp(gif).extractChannel('alpha').raw().toBuffer())).toBe(true);
  });

  const BMP_PICTURE: Pick<BmpOptions, 'width' | 'height' | 'pixel'> = {
    width: 37,
    height: 23,
    pixel: (x, y) => (x < 18 ? (y < 11 ? [220, 20, 20, 255] : [20, 20, 220, 255]) : y < 11 ? [20, 200, 20, 255] : [250, 250, 250, 255]),
  };

  it.each([
    ['24-bit, bottom row first', { bitsPerPixel: 24 }],
    ['24-bit, top row first', { bitsPerPixel: 24, topDown: true }],
    ['32-bit without alpha', { bitsPerPixel: 32 }],
    ['8-bit palette', { bitsPerPixel: 8 }],
    ['8-bit run-length encoded', { bitsPerPixel: 8, runLength: true }],
    ['4-bit palette', { bitsPerPixel: 4 }],
  ] as const)('converts a %s BMP with its exact pixels', async (_label, layout) => {
    const options: BmpOptions = { ...BMP_PICTURE, ...layout };

    const page = await onlyPage(createBmp(options));

    expect([page.pixelWidth, page.pixelHeight]).toEqual([37, 23]);
    expect(page.decodedBytes.equals(expectedBmpPixels(options))).toBe(true);
    expect(page.alpha).toBeUndefined();
  });

  it('converts a 1-bit BMP', async () => {
    const options: BmpOptions = {
      width: 19,
      height: 7,
      pixel: (x, y) => ((x + y) % 3 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]),
      bitsPerPixel: 1,
    };

    const page = await onlyPage(createBmp(options));

    expect(page.decodedBytes.equals(expectedBmpPixels(options))).toBe(true);
  });

  it('converts a 32-bit BMP with an alpha channel, keeping its transparency', async () => {
    const options: BmpOptions = {
      width: 20,
      height: 10,
      pixel: (x, y) => [x * 12, y * 25, 90, (x * 13 + y * 7) % 256],
      bitsPerPixel: 32,
      alpha: true,
    };
    const rgba = expectedBmpPixels(options, true);

    const page = await onlyPage(createBmp(options));

    expect(page.decodedBytes.equals(await sharp(rgba, { raw: { width: 20, height: 10, channels: 4 } }).removeAlpha().raw().toBuffer())).toBe(true);
    expect(page.alpha?.equals(await sharp(rgba, { raw: { width: 20, height: 10, channels: 4 } }).extractChannel(3).raw().toBuffer())).toBe(true);
  });

  it('draws a BMP at the size its resolution gives', async () => {
    const options: BmpOptions = { ...BMP_PICTURE, bitsPerPixel: 24, pixelsPerMetre: 11811 };

    const page = await onlyPage(createBmp(options));

    // 11,811 pixels per metre is 300 dpi.
    expect(page.placement.width).toBeCloseTo((37 * 72) / 300, 1);
  });

  it.each([
    ['cut off half-way through its pixels', (bmp: Buffer) => bmp.subarray(0, Math.floor(bmp.length * 0.6))],
    ['claiming more rows than it holds', (bmp: Buffer) => {
      const lying = Buffer.from(bmp);
      lying.writeInt32LE(4000, 22);
      return lying;
    }],
  ])('refuses a BMP %s as damaged', async (_label, damage) => {
    const bmp = damage(createBmp({ ...BMP_PICTURE, bitsPerPixel: 24 }));

    expect(await refusalOf(convert([bmp], NO_WORKER_ALLOWED))).toEqual({ status: 400, message: DAMAGED });
  });

  it('refuses a BMP over the pixel limit from its header alone', async () => {
    const header = createBmp({ ...BMP_PICTURE, bitsPerPixel: 24 });
    header.writeInt32LE(10_001, 18);
    header.writeInt32LE(5_000, 22);

    expect(await refusalOf(convert([header], NO_WORKER_ALLOWED))).toEqual({
      status: 400,
      message: 'Image 1 is 50.1 megapixels. Each image can be at most 50 megapixels.',
    });
  });

  it('decodes a run-length BMP whose runs overflow its rows without hanging', async () => {
    const bmp = createBmp({ ...BMP_PICTURE, bitsPerPixel: 8, runLength: true });
    const pixelDataOffset = bmp.readUInt32LE(10);
    // The first run claims 255 pixels of a 37-pixel row.
    bmp[pixelDataOffset] = 255;

    const outcome = await convert([bmp]).then(
      (pdf) => ({ converted: pdf.length > 0 }),
      (error: unknown) => ({ refused: (error as Error).message }),
    );

    expect([{ converted: true }, { refused: DAMAGED }]).toContainEqual(outcome);
  });
});

describe('convertImagesToPdf — what is kept exactly', () => {
  it.each([
    ['baseline', {}],
    ['progressive', { progressive: true }],
  ])('stores an upright sRGB %s JPEG byte for byte', async (_label, jpegOptions) => {
    const photo = await photoLikePixels(320, 200).jpeg(jpegOptions).toBuffer();

    const page = await onlyPage(photo);

    expect(page.filter).toBe('DCTDecode');
    expect(page.storedBytes.equals(photo)).toBe(true);
  });

  it('stores a JPEG whose embedded profile is sRGB byte for byte', async () => {
    const photo = await photoLikePixels(120, 80).withIccProfile('srgb').jpeg().toBuffer();
    expect((await sharp(photo).metadata()).icc).toBeDefined();

    const page = await onlyPage(photo);

    expect(page.storedBytes.equals(photo)).toBe(true);
  });

  it('stores a greyscale JPEG byte for byte, as grey', async () => {
    const grey = await photoLikePixels(120, 80).toColourspace('b-w').jpeg().toBuffer();
    expect((await sharp(grey).metadata()).channels).toBe(1);

    const page = await onlyPage(grey);

    expect(page.storedBytes.equals(grey)).toBe(true);
    expect(page.colourSpace).toBe('DeviceGray');
  });

  it.each([
    ['true-colour', (image: sharp.Sharp) => image.png()],
    ['palette', (image: sharp.Sharp) => image.png({ palette: true, colours: 16 })],
    ['interlaced', (image: sharp.Sharp) => image.png({ progressive: true })],
  ])('keeps every pixel of a %s PNG', async (_label, encode) => {
    const encoded = await encode(photoLikePixels(64, 48)).toBuffer();

    const page = await onlyPage(encoded);

    expect(page.colourSpace).toBe('DeviceRGB');
    expect(page.decodedBytes.equals(await sharp(encoded).removeAlpha().raw().toBuffer())).toBe(true);
  });

  it('keeps every pixel of a greyscale PNG, as grey', async () => {
    const encoded = await photoLikePixels(64, 48).toColourspace('b-w').png().toBuffer();
    expect((await sharp(encoded).metadata()).channels).toBe(1);

    const page = await onlyPage(encoded);

    expect(page.colourSpace).toBe('DeviceGray');
    expect(page.decodedBytes.equals(await sharp(encoded).extractChannel(0).raw().toBuffer())).toBe(true);
  });

  it('keeps all 16 bits of a 16-bit PNG', async () => {
    const samples = new Uint16Array(32 * 16 * 3).map((_, index) => (index * 2741) % 65536);
    const png16 = await sharp(samples, { raw: { width: 32, height: 16, channels: 3 } }).toColourspace('rgb16').png().toBuffer();
    expect((await sharp(png16).metadata()).depth).toBe('ushort');

    const page = await onlyPage(png16);

    expect(page.bitsPerComponent).toBe(16);
    expect(page.decodedBytes.equals(await sharp(png16).raw({ depth: 'ushort' }).toBuffer())).toBe(true);
  });

  it('keeps the transparency of a PNG', async () => {
    const width = 40;
    const height = 30;
    const rgba = Buffer.alloc(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      rgba.set([pixel % 256, (pixel * 7) % 256, 90, (pixel * 3) % 256], pixel * 4);
    }
    const transparentPng = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();

    const page = await onlyPage(transparentPng);

    expect(page.decodedBytes.equals(await sharp(transparentPng).removeAlpha().raw().toBuffer())).toBe(true);
    expect(page.alpha?.equals(await sharp(transparentPng).extractChannel('alpha').raw().toBuffer())).toBe(true);
  });

  it('converts a PNG that ends without IEND but whose pixels are all there', async () => {
    const png = await photoLikePixels(64, 48).png().toBuffer();
    const withoutEnd = png.subarray(0, png.length - 12);

    const page = await onlyPage(withoutEnd);

    expect(page.decodedBytes.equals(await sharp(png).raw().toBuffer())).toBe(true);
  });
});

describe('convertImagesToPdf — colour', () => {
  // The reference is sharp's colour-managed decode to sRGB: the embedded profile, or
  // sharp's own CMYK profile for a CMYK file without one.
  async function expectRenderedLikeReference(image: Buffer) {
    const pdf = await convert([image]);
    const [placed] = await readPdfPageImages(pdf);
    const scale = 2;
    const [page] = await renderPdfPages(pdf, scale);
    const reference = await sharp(image).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });

    for (const [fx, fy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      const offset = (Math.floor(fy * reference.info.height) * reference.info.width + Math.floor(fx * reference.info.width)) * 3;
      expectWithin(colourInside(page, placed, fx, fy, scale), [...reference.data.subarray(offset, offset + 3)], RENDER_TOLERANCE);
    }
    return placed;
  }

  function quadrants(): sharp.Sharp {
    const width = 80;
    const height = 60;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const colour = x < width / 2 ? (y < height / 2 ? [230, 20, 20] : [20, 40, 210]) : y < height / 2 ? [30, 190, 40] : [240, 200, 30];
        pixels.set(colour, (y * width + x) * 3);
      }
    }
    return sharp(pixels, { raw: { width, height, channels: 3 } });
  }

  // A JPEG re-encoded only for its colours stays a JPEG. Measured on photographs at
  // quality 95 without chroma subsampling: 0.56 to 1.73 times the upload, a mean
  // difference from the reference of 0.5 and at most 9.
  const SIZE_BOUND = 2;
  const PHOTO_MEAN_TOLERANCE = 1;
  const PHOTO_MAX_TOLERANCE = 12;

  // Every pixel as pdf.js draws it, one rendered pixel per image pixel, against the reference.
  async function renderedDifference(pdf: Buffer, image: Buffer) {
    const [placed] = await readPdfPageImages(pdf);
    const scale = placed.pixelWidth / placed.placement.width;
    const [page] = await renderPdfPages(pdf, scale);
    const reference = await sharp(image).rotate().toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const shown = await sharp(page.rgba, { raw: { width: page.width, height: page.height, channels: 4 } })
      .extract({
        left: Math.round(placed.placement.x * scale),
        top: Math.round((placed.pageHeight - placed.placement.y - placed.placement.height) * scale),
        width: reference.info.width,
        height: reference.info.height,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    let total = 0;
    let max = 0;
    shown.forEach((value, index) => {
      const difference = Math.abs(value - reference.data[index]);
      total += difference;
      max = Math.max(max, difference);
    });
    return { mean: total / shown.length, max };
  }

  it('shows a CMYK JPEG in the colours of its colour-managed decode, as a JPEG', async () => {
    const cmyk = await quadrants().toColourspace('cmyk').jpeg({ quality: 95 }).toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe('cmyk');

    const placed = await expectRenderedLikeReference(cmyk);

    expect(placed.filter).toBe('DCTDecode');
    expect(placed.colourSpace).toBe('DeviceRGB');
  });

  it('shows a Display P3 JPEG in the sRGB colours it was authored in, as a JPEG', async () => {
    const p3 = await displayP3Patch().jpeg({ quality: 100 }).toBuffer();
    const stored = await storedFirstPixel(p3);
    expect(Math.max(...stored.map((value, channel) => Math.abs(value - AUTHORED_SRGB[channel])))).toBeGreaterThan(10);

    const placed = await expectRenderedLikeReference(p3);

    expect(placed.filter).toBe('DCTDecode');
    expectWithin(await firstPixel(placed.storedBytes), displayP3ToSrgb(stored), 2);
  });

  it.each([
    ['Display P3', (image: sharp.Sharp) => image.withIccProfile('p3').jpeg({ quality: 90 })],
    ['CMYK', (image: sharp.Sharp) => image.toColourspace('cmyk').jpeg({ quality: 90 })],
  ])('keeps a %s photograph within twice its size and close to its colour-managed decode', async (_label, encode) => {
    const photo = await encode(photoLikePixels(400, 300).blur(1.2)).toBuffer();

    const pdf = await convert([photo]);
    const [placed] = await readPdfPageImages(pdf);
    const { mean, max } = await renderedDifference(pdf, photo);

    expect(placed.filter).toBe('DCTDecode');
    expect(pdf.length).toBeLessThanOrEqual(SIZE_BOUND * photo.length);
    expect(mean).toBeLessThanOrEqual(PHOTO_MEAN_TOLERANCE);
    expect(max).toBeLessThanOrEqual(PHOTO_MAX_TOLERANCE);
  });

  it('turns a Display P3 JPEG upright when it converts its colours', async () => {
    const p3 = await orientedPicture(6).withIccProfile('p3').jpeg({ quality: 95 }).toBuffer();
    expect((await sharp(p3).metadata()).orientation).toBe(6);

    const pdf = await convert([p3]);

    expect((await readPdfPageImages(pdf))[0].filter).toBe('DCTDecode');
    expect(await shownCorners(pdf)).toEqual([UPRIGHT_CORNERS.corners]);
  });

  it('converts a Display P3 PNG to sRGB', async () => {
    const p3 = await displayP3Patch().png().toBuffer();

    const page = await onlyPage(p3);

    expect([...page.decodedBytes.subarray(0, 3)]).toEqual([...(await sharp(p3).toColourspace('srgb').raw().toBuffer()).subarray(0, 3)]);
  });
});

describe('convertImagesToPdf — damaged JPEGs', () => {
  async function jpegWithStartOfFrame(change: (jpeg: Buffer, startOfFrame: number) => void): Promise<Buffer> {
    const jpeg = Buffer.from(await createPhotoJpeg(64, 48));
    change(jpeg, jpeg.indexOf(Buffer.from([0xff, 0xc0])));
    return jpeg;
  }

  it.each([
    ['cut off half-way', async () => {
      const jpeg = await createPhotoJpeg();
      return jpeg.subarray(0, Math.floor(jpeg.length / 2));
    }],
    ['whose header claims 12-bit samples', () => jpegWithStartOfFrame((jpeg, at) => (jpeg[at + 4] = 12))],
    ['using arithmetic coding', () => jpegWithStartOfFrame((jpeg, at) => (jpeg[at + 1] = 0xc9))],
  ])('refuses a JPEG %s before pdf-lib sees it', async (_label, createJpeg) => {
    expect(await refusalOf(convert([await createJpeg()], NO_WORKER_ALLOWED))).toEqual({ status: 400, message: DAMAGED });
  });

  it('names the damaged image when it is not the first', async () => {
    const good = await createPhotoJpeg();
    const cut = good.subarray(0, Math.floor(good.length / 2));

    expect((await refusalOf(convert([good, cut], NO_WORKER_ALLOWED))).message).toBe(
      'Image 2 is damaged or incomplete and could not be read.',
    );
  });
});
