import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';
import { assertPixelCountWithinLimit, MAX_IMAGE_PIXELS } from '@/lib/convert/image-limits';
import { readBmpHeader } from '@/lib/image/bmp';

/** The formats an image tool can re-encode an image in. */
export type ImageFormat = 'jpeg' | 'png' | 'webp';

/** Every format `detectImageFormat` identifies; each tool accepts some of them. */
export type DetectedImageFormat = ImageFormat | 'gif' | 'tiff' | 'avif' | 'bmp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF = Buffer.from('RIFF', 'latin1');
const WEBP = Buffer.from('WEBP', 'latin1');
const GIF_SIGNATURES = [Buffer.from('GIF87a', 'latin1'), Buffer.from('GIF89a', 'latin1')];
const TIFF_LITTLE_ENDIAN = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BIG_ENDIAN = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
const FILE_TYPE_BOX = Buffer.from('ftyp', 'latin1');
const AVIF_STILL = 'avif';
const AVIF_SEQUENCE = 'avis';

function hasBytesAt(bytes: Buffer, offset: number, expected: Buffer): boolean {
  return bytes.subarray(offset, offset + expected.length).equals(expected);
}

// Real files list a handful; the box's own size field is not trusted to bound the read.
const MAX_FILE_TYPE_BOX = 16 + 4 * 32;

// The major and compatible brands of the `ftyp` box an ISO media file starts with. HEIC,
// which no decoder here reads, comes in the same container under other brands.
function fileTypeBrands(bytes: Buffer): string[] {
  if (bytes.length < 16 || !hasBytesAt(bytes, 4, FILE_TYPE_BOX)) {
    return [];
  }
  const boxEnd = Math.min(bytes.readUInt32BE(0), bytes.length, MAX_FILE_TYPE_BOX);
  const brands = [bytes.toString('latin1', 8, 12)];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    brands.push(bytes.toString('latin1', offset, offset + 4));
  }
  return brands;
}

function isAvif(bytes: Buffer): boolean {
  const brands = fileTypeBrands(bytes);
  return brands.includes(AVIF_STILL) || brands.includes(AVIF_SEQUENCE);
}

/**
 * Identifies an upload by its leading bytes, never by its name or the type the client
 * claims. Nothing that is not identified here may reach sharp: sharp also opens SVG,
 * and rasterising one has no bound on its cost. Even its header read is not cheap for
 * every format it knows: to report the size of an SVG, librsvg parses the whole
 * document, which took 5.7s and 626 MB for an 18 MB file of 300,000 elements.
 */
export function detectImageFormat(bytes: Buffer): DetectedImageFormat | null {
  if (hasBytesAt(bytes, 0, PNG_SIGNATURE)) {
    return 'png';
  }
  if (hasBytesAt(bytes, 0, JPEG_START)) {
    return 'jpeg';
  }
  if (hasBytesAt(bytes, 0, RIFF) && hasBytesAt(bytes, 8, WEBP)) {
    return 'webp';
  }
  if (GIF_SIGNATURES.some((signature) => hasBytesAt(bytes, 0, signature))) {
    return 'gif';
  }
  if (hasBytesAt(bytes, 0, TIFF_LITTLE_ENDIAN) || hasBytesAt(bytes, 0, TIFF_BIG_ENDIAN)) {
    return 'tiff';
  }
  if (isAvif(bytes)) {
    return 'avif';
  }
  if (readBmpHeader(bytes)) {
    return 'bmp';
  }
  return null;
}

const PNG_CHUNKS_START = PNG_SIGNATURE.length;
const PNG_ANIMATION_CONTROL = Buffer.from('acTL', 'latin1').readUInt32BE();
const PNG_IMAGE_DATA = Buffer.from('IDAT', 'latin1').readUInt32BE();
const WEBP_EXTENDED_HEADER = Buffer.from('VP8X', 'latin1');
const WEBP_ANIMATION_FLAG = 0x02;

// An animated PNG announces itself with an `acTL` chunk before its image data; a decoder
// that does not know the chunk shows the first frame as a still image. Chunk types are
// compared as numbers: a 25 MB file can hold two million empty chunks.
function isAnimatedPng(bytes: Buffer): boolean {
  for (let offset = PNG_CHUNKS_START; offset + 8 <= bytes.length; ) {
    const type = bytes.readUInt32BE(offset + 4);
    if (type === PNG_ANIMATION_CONTROL) {
      return true;
    }
    if (type === PNG_IMAGE_DATA) {
      return false;
    }
    offset += 12 + bytes.readUInt32BE(offset);
  }
  return false;
}

// An animated WebP sets the animation flag in its extended header, which comes first.
function isAnimatedWebp(bytes: Buffer): boolean {
  return hasBytesAt(bytes, 12, WEBP_EXTENDED_HEADER) && bytes.length > 20 && (bytes[20] & WEBP_ANIMATION_FLAG) !== 0;
}

// A TIFF's first directory ends with the offset of the next one, which is zero when the
// file holds a single page.
function hasSeveralTiffPages(bytes: Buffer): boolean {
  const littleEndian = bytes[0] === 0x49;
  const readUInt16 = (offset: number) => (littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const readUInt32 = (offset: number) => (littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  if (bytes.length < 8) {
    return false;
  }
  const firstDirectory = readUInt32(4);
  if (firstDirectory + 2 > bytes.length) {
    return false;
  }
  const nextDirectoryAt = firstDirectory + 2 + 12 * readUInt16(firstDirectory);
  return nextDirectoryAt + 4 <= bytes.length && readUInt32(nextDirectoryAt) !== 0;
}

function isAnimated(bytes: Buffer, format: DetectedImageFormat): boolean {
  switch (format) {
    case 'png':
      return isAnimatedPng(bytes);
    case 'webp':
      return isAnimatedWebp(bytes);
    case 'avif':
      return fileTypeBrands(bytes).includes(AVIF_SEQUENCE);
    default:
      return false;
  }
}

/**
 * Reads an image's header without decoding its pixels. sharp's own pixel limit is
 * lifted here so that an image over ours can be refused by name rather than reported
 * as unreadable. Only call this on bytes `detectImageFormat` has identified as a
 * format sharp reads, which BMP is not.
 */
export function readImageHeader(bytes: Buffer): Promise<sharp.Metadata> {
  return sharp(bytes, { limitInputPixels: false }).metadata();
}

/** What an image's header says about it, whatever its format. */
export interface ImageHeader {
  /** The size its pixels are stored at, before any EXIF orientation is applied. */
  width: number;
  height: number;
  /** How the file stores its pixels. */
  space: sharp.Metadata['space'];
  depth: sharp.Metadata['depth'];
  hasAlpha: boolean;
  /** The EXIF orientation, 1 to 8; 1 when the file has none. */
  orientation: number;
  /** Pixels per inch, when the file states it. */
  density?: number;
  /** The embedded colour profile, if there is one. */
  icc?: Buffer;
}

export interface AcceptedImage<Format extends DetectedImageFormat = ImageFormat> extends ImageHeader {
  /** The image's position in the request, from 1, for messages. */
  imageNumber: number;
  bytes: Buffer;
  format: Format;
}

const FORMAT_NAMES: Record<DetectedImageFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  tiff: 'TIFF',
  avif: 'AVIF',
  bmp: 'BMP',
};

// The format sharp's header reports for each; AVIF comes in a HEIF container.
const SHARP_FORMATS: Record<Exclude<DetectedImageFormat, 'bmp'>, string> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  tiff: 'tiff',
  avif: 'heif',
};

function listFormats(formats: readonly DetectedImageFormat[]): string {
  const names = formats.map((format) => FORMAT_NAMES[format]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}

/**
 * Opens an accepted image to be re-encoded: turned upright from its EXIF orientation,
 * and in sRGB, which sharp converts any embedded profile to on output. A greyscale image
 * stays greyscale, where by default sharp would write it out as RGB, three times the
 * samples for the same picture. No metadata is carried over.
 */
export function openAcceptedImage({ bytes, space }: AcceptedImage<DetectedImageFormat>): sharp.Sharp {
  const upright = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
  return space === 'b-w' ? upright.toColourspace('b-w') : upright;
}

export function damagedImageError(imageNumber: number, cause?: unknown): ClientError {
  return new ClientError(`Image ${imageNumber} is damaged or incomplete and could not be read.`, 400, { cause });
}

function animatedImageError(imageNumber: number): ClientError {
  return new ClientError(`Image ${imageNumber} is animated. Animated images are not supported.`);
}

function multiPageImageError(imageNumber: number): ClientError {
  return new ClientError(`Image ${imageNumber} has more than one page. Images with several pages are not supported.`);
}

function readBmpImageHeader(bytes: Buffer): ImageHeader {
  const { width, height, hasAlpha, density } = readBmpHeader(bytes)!;
  return { width, height, hasAlpha, density, space: 'srgb', depth: 'uchar', orientation: 1 };
}

async function readSharpImageHeader(
  bytes: Buffer,
  format: Exclude<DetectedImageFormat, 'bmp'>,
  imageNumber: number,
): Promise<ImageHeader> {
  let header: sharp.Metadata;
  try {
    header = await readImageHeader(bytes);
  } catch (error) {
    throw damagedImageError(imageNumber, error);
  }
  if (header.format !== SHARP_FORMATS[format] || !header.width || !header.height) {
    throw damagedImageError(imageNumber);
  }
  if (format === 'avif' && header.compression !== 'av1') {
    throw damagedImageError(imageNumber);
  }
  // The decoder counts a GIF's frames as it reads the header, off the event loop; walking
  // the blocks here instead blocked it for 0.16 to 0.24s on 25 MB of empty ones. For the
  // other formats this backs up the checks on the raw bytes.
  if ((header.pages ?? 1) > 1) {
    throw format === 'tiff' ? multiPageImageError(imageNumber) : animatedImageError(imageNumber);
  }

  return {
    width: header.width,
    height: header.height,
    space: header.space,
    depth: header.depth,
    hasAlpha: header.hasAlpha ?? false,
    orientation: header.orientation ?? 1,
    density: header.density,
    icc: header.icc,
  };
}

/**
 * Checks one upload before any of its pixels are decoded, and refuses it with a message
 * naming it: empty, not one of the `accepted` formats, animated or of several pages, a
 * header that cannot be read, or over the pixel limit.
 */
export async function acceptImage<Format extends DetectedImageFormat>(
  bytes: Buffer,
  imageNumber: number,
  accepted: readonly Format[],
): Promise<AcceptedImage<Format>> {
  if (bytes.length === 0) {
    throw new ClientError(`Image ${imageNumber} is empty.`);
  }

  const format = detectImageFormat(bytes);
  if (!format || !accepted.includes(format as Format)) {
    throw new ClientError(
      `Image ${imageNumber} is not a supported image type. Only ${listFormats(accepted)} images are accepted.`,
    );
  }
  if (isAnimated(bytes, format)) {
    throw animatedImageError(imageNumber);
  }
  if (format === 'tiff' && hasSeveralTiffPages(bytes)) {
    throw multiPageImageError(imageNumber);
  }

  const header = format === 'bmp' ? readBmpImageHeader(bytes) : await readSharpImageHeader(bytes, format, imageNumber);
  assertPixelCountWithinLimit(imageNumber, header.width, header.height);

  return { ...header, imageNumber, bytes, format: format as Format };
}
