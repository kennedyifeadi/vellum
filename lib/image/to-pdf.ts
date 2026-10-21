import path from 'path';
import sharp from 'sharp';
import { MAX_IMAGE_PIXELS } from '@/lib/convert/image-limits';
import { runWorkerJob, WorkerJobError, type WorkerLimits } from '@/lib/convert/worker-job';
import { BmpDecodeTimeoutError, decodeBmp, readBmpHeader } from '@/lib/image/bmp';
import { profileShowsAsSrgb } from '@/lib/image/colour-profile';
import { runImageJob } from '@/lib/image/image-jobs';
import { acceptImage, damagedImageError, type AcceptedImage, type DetectedImageFormat } from '@/lib/image/input';
import { layoutImagePage, type PageLayout } from '@/lib/image/pdf-layout';

const WORKER_PATH = path.join(process.cwd(), 'lib', 'image', 'to-pdf-worker.mjs');

const ACCEPTED_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif', 'bmp'] as const satisfies DetectedImageFormat[];
type PdfImage = AcceptedImage<(typeof ACCEPTED_FORMATS)[number]>;

// Re-encoded images are stored losslessly, as PNG-filtered Flate streams. Level 1 with
// adaptive filtering was the fastest setting that compresses: 10.6s for a 48-megapixel
// photograph against 28s at level 3, at about the size pdf-lib's own PNG embedding gave.
const PNG_ENCODING: sharp.PngOptions = { compressionLevel: 1, adaptiveFiltering: true };

// A JPEG re-encoded only to convert its colours (CMYK, or a Display P3 or Adobe RGB
// profile) stays a JPEG: stored losslessly, a phone photo's PDF was 12 times the upload.
// At quality 95 without chroma subsampling it is about the size of the upload.
const CONVERTED_JPEG_ENCODING: sharp.JpegOptions = { quality: 95, chromaSubsampling: '4:4:4' };

interface ImageToPdfOptions {
  imageBuffers: Buffer[];
  limits: WorkerLimits;
}

interface JpegPage {
  kind: 'jpeg';
  imageNumber: number;
  bytes: Uint8Array;
  layout: PageLayout;
}

interface PixelStream {
  /** 1 for grey, 3 for RGB. */
  colours: number;
  bitsPerComponent: number;
  /** A zlib stream of PNG-filtered rows, which PDF's FlateDecode reads with predictor 15. */
  data: Uint8Array;
}

interface PixelsPage {
  kind: 'pixels';
  width: number;
  height: number;
  colour: PixelStream;
  alpha?: PixelStream;
  layout: PageLayout;
}

type PreparedPage = JpegPage | PixelsPage;

type RawPixels = { data: Buffer; info: sharp.OutputInfo; sixteenBit: boolean };

const DEADLINE_MESSAGE = 'Image to PDF conversion exceeded its deadline';

/**
 * The bytes in an ArrayBuffer of their own. pdf-lib misreads a view into a larger
 * ArrayBuffer, which is what Node's small Buffers are, and posting one to a worker
 * copies the whole of what it views.
 */
function ownedBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : Uint8Array.from(bytes);
}

function remainingMs(deadline: number): number {
  return deadline - performance.now();
}

function assertBeforeDeadline(deadline: number): void {
  if (remainingMs(deadline) <= 0) {
    throw new WorkerJobError('deadline', DEADLINE_MESSAGE);
  }
}

function isGrey({ space }: PdfImage): boolean {
  return space === 'b-w' || space === 'grey16';
}

async function needsColourConversion(image: PdfImage): Promise<boolean> {
  if (image.space === 'cmyk') {
    return true;
  }
  return image.icc !== undefined && !(await profileShowsAsSrgb(image.icc, isGrey(image)));
}

function canEmbedAsStored(image: PdfImage, colourConversion: boolean): boolean {
  return (
    image.format === 'jpeg' &&
    !colourConversion &&
    image.depth === 'uchar' &&
    (image.space === 'srgb' || image.space === 'b-w')
  );
}

const START_OF_SCAN = 0xda;
// Arithmetic-coded frames (SOF9-11, SOF13-15). Whether libvips decodes them depends on how
// its libjpeg was built: sharp's Windows build refuses them, its Linux build does not.
const ARITHMETIC_FRAME_MARKERS = new Set([0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function usesArithmeticCoding(bytes: Uint8Array): boolean {
  let at = 2;
  while (at + 3 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (ARITHMETIC_FRAME_MARKERS.has(marker)) return true;
    if (marker === START_OF_SCAN) return false;
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }
  return false;
}

// pdf-lib only scans a JPEG's markers, so a file cut off half-way would be embedded and
// shown half grey. libvips reads every scan; reducing to one pixel keeps it from holding
// the decoded image. An arithmetic-coded JPEG is refused on every platform, whatever the
// local libjpeg can decode, because PDF readers need not support it.
async function assertJpegDecodes({ bytes, imageNumber }: PdfImage): Promise<void> {
  if (usesArithmeticCoding(bytes)) {
    throw damagedImageError(imageNumber);
  }
  try {
    await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).resize(1, 1, { fit: 'fill' }).raw().toBuffer();
  } catch (error) {
    throw damagedImageError(imageNumber, error);
  }
}

async function openForDecoding(image: PdfImage, colourConversion: boolean, deadline: number): Promise<sharp.Sharp> {
  if (image.format !== 'bmp') {
    return sharp(image.bytes, { limitInputPixels: MAX_IMAGE_PIXELS, ignoreIcc: !colourConversion }).rotate();
  }
  const header = readBmpHeader(image.bytes)!;
  try {
    const pixels = await decodeBmp(image.bytes, header, remainingMs(deadline));
    return sharp(pixels, { raw: { width: header.width, height: header.height, channels: header.hasAlpha ? 4 : 3 } });
  } catch (error) {
    if (error instanceof BmpDecodeTimeoutError) {
      throw new WorkerJobError('deadline', DEADLINE_MESSAGE);
    }
    throw damagedImageError(image.imageNumber, error);
  }
}

function colourspaceFor(grey: boolean, sixteenBit: boolean): string {
  if (grey) {
    return sixteenBit ? 'grey16' : 'b-w';
  }
  return sixteenBit ? 'rgb16' : 'srgb';
}

// Upright, in sRGB unless the file is greyscale, and at 16 bits a sample if the file has
// them. A profile that shows as sRGB is ignored, so such a file keeps its values exactly.
async function decodeUpright(image: PdfImage, colourConversion: boolean, deadline: number): Promise<RawPixels> {
  const pipeline = await openForDecoding(image, colourConversion, deadline);
  const sixteenBit = image.depth === 'ushort';
  try {
    const { data, info } = await pipeline
      .toColourspace(colourspaceFor(isGrey(image), sixteenBit))
      .raw({ depth: sixteenBit ? 'ushort' : 'uchar' })
      .toBuffer({ resolveWithObject: true });
    return { data, info, sixteenBit };
  } catch (error) {
    throw damagedImageError(image.imageNumber, error);
  }
}

const PNG_FIRST_CHUNK = 8;
const PNG_GREY = 0;
const PNG_RGB = 2;

// The pixel data of a PNG sharp has just written: its IDAT chunks joined are one zlib
// stream of filtered rows.
function pngPixelStream(png: Buffer): PixelStream {
  const parts: Buffer[] = [];
  let colours = 0;
  let bitsPerComponent = 0;
  for (let offset = PNG_FIRST_CHUNK; offset + 8 <= png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      const [colourType, interlace] = [data[9], data[12]];
      if ((colourType !== PNG_GREY && colourType !== PNG_RGB) || interlace !== 0) {
        throw new Error(`sharp wrote a PNG of colour type ${colourType}, interlace ${interlace}`);
      }
      bitsPerComponent = data[8];
      colours = colourType === PNG_GREY ? 1 : 3;
    } else if (type === 'IDAT') {
      parts.push(data);
    }
    offset += 12 + length;
  }
  return { colours, bitsPerComponent, data: ownedBytes(Buffer.concat(parts)) };
}

// sharp reads raw 16-bit samples only from a Uint16Array.
function samplesOf({ data, sixteenBit }: RawPixels): Uint8Array | Uint16Array {
  if (!sixteenBit) {
    return data;
  }
  const aligned = data.byteOffset % 2 === 0 ? data : Buffer.from(data);
  return new Uint16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2);
}

// PDF takes an image's alpha as a separate greyscale image, its soft mask.
async function encodeStreams(pixels: RawPixels): Promise<Pick<PixelsPage, 'colour' | 'alpha'>> {
  const { width, height, channels } = pixels.info;
  const hasAlpha = channels === 2 || channels === 4;
  const { sixteenBit } = pixels;
  const raw = () => sharp(samplesOf(pixels), { raw: { width, height, channels } });

  const [colour, alpha] = await Promise.all([
    (hasAlpha ? raw().removeAlpha() : raw())
      .toColourspace(colourspaceFor(channels <= 2, sixteenBit))
      .png(PNG_ENCODING)
      .toBuffer(),
    hasAlpha
      ? raw()
          .extractChannel(channels === 4 ? 3 : 1)
          .toColourspace(colourspaceFor(true, sixteenBit))
          .png(PNG_ENCODING)
          .toBuffer()
      : undefined,
  ]);
  return { colour: pngPixelStream(colour), alpha: alpha && pngPixelStream(alpha) };
}

// Upright and in sRGB (grey stays grey), with no metadata, so it needs no transform.
async function convertJpegColours(image: PdfImage, deadline: number): Promise<JpegPage> {
  const pipeline = await openForDecoding(image, true, deadline);
  let converted: { data: Buffer; info: sharp.OutputInfo };
  try {
    converted = await pipeline
      .toColourspace(colourspaceFor(isGrey(image), false))
      .jpeg(CONVERTED_JPEG_ENCODING)
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw damagedImageError(image.imageNumber, error);
  }
  return {
    kind: 'jpeg',
    imageNumber: image.imageNumber,
    bytes: ownedBytes(converted.data),
    layout: layoutImagePage({
      storedWidth: converted.info.width,
      storedHeight: converted.info.height,
      orientation: 1,
      density: image.density,
    }),
  };
}

async function preparePage(image: PdfImage, deadline: number): Promise<PreparedPage> {
  const colourConversion = await needsColourConversion(image);

  if (image.format === 'jpeg' && colourConversion) {
    return convertJpegColours(image, deadline);
  }
  if (canEmbedAsStored(image, colourConversion)) {
    await assertJpegDecodes(image);
    return {
      kind: 'jpeg',
      imageNumber: image.imageNumber,
      bytes: ownedBytes(image.bytes),
      layout: layoutImagePage({
        storedWidth: image.width,
        storedHeight: image.height,
        orientation: image.orientation,
        density: image.density,
      }),
    };
  }

  const pixels = await decodeUpright(image, colourConversion, deadline);
  const { width, height } = pixels.info;
  return {
    kind: 'pixels',
    width,
    height,
    ...(await encodeStreams(pixels)),
    layout: layoutImagePage({ storedWidth: width, storedHeight: height, orientation: 1, density: image.density }),
  };
}

// One image at a time, so that only one is decoded at once. A decode in progress cannot
// be stopped, so the deadline is checked between images.
async function preparePages(images: PdfImage[], deadline: number): Promise<PreparedPage[]> {
  const pages: PreparedPage[] = [];
  for (const image of images) {
    assertBeforeDeadline(deadline);
    pages.push(await preparePage(image, deadline));
  }
  assertBeforeDeadline(deadline);
  return pages;
}

function transferablesOf(pages: PreparedPage[]): ArrayBuffer[] {
  return pages
    .flatMap((page) => (page.kind === 'pixels' ? [page.colour, page.alpha] : []))
    .filter((stream) => stream !== undefined)
    .map((stream) => stream.data.buffer as ArrayBuffer);
}

function readPdf(message: unknown): Buffer {
  const result = message as { kind?: unknown; bytes?: unknown; imageNumber?: unknown } | null;

  if (result?.kind === 'unreadable-jpeg' && typeof result.imageNumber === 'number') {
    throw damagedImageError(result.imageNumber);
  }
  if (result?.kind === 'pdf' && ArrayBuffer.isView(result.bytes)) {
    const { buffer, byteOffset, byteLength } = result.bytes;
    return Buffer.from(buffer, byteOffset, byteLength);
  }
  throw new Error('Image to PDF worker returned an unexpected result');
}

/**
 * Builds a PDF with one page per image, in order, each laid out by `layoutImagePage`.
 * Every image is accepted from its header first. Then, holding an image job slot, each
 * is fully decoded: a JPEG that needs no colour conversion is kept byte for byte and
 * turned upright by the page's drawing transform; a JPEG that does is decoded upright,
 * converted to sRGB and stored as a quality-95 JPEG; anything else is decoded upright,
 * converted to sRGB (greyscale stays grey, 16 bits stay 16) and stored losslessly.
 * pdf-lib then assembles the pages in a worker thread, see `runWorkerJob` for how that
 * is bounded. `limits.deadlineMs` covers the whole conversion.
 */
export async function convertImagesToPdf({ imageBuffers, limits }: ImageToPdfOptions): Promise<Buffer> {
  const deadline = performance.now() + limits.deadlineMs;
  const images: PdfImage[] = [];
  for (const [index, imageBuffer] of imageBuffers.entries()) {
    images.push(await acceptImage(imageBuffer, index + 1, ACCEPTED_FORMATS));
  }

  const pages = await runImageJob(() => preparePages(images, deadline));
  return runWorkerJob({
    name: 'Image to PDF conversion',
    workerPath: WORKER_PATH,
    workerData: { pages },
    transferList: transferablesOf(pages),
    limits: { ...limits, deadlineMs: remainingMs(deadline) },
    readMessage: readPdf,
  });
}
