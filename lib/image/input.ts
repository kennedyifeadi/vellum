import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';

export type ImageFormat = 'jpeg' | 'png' | 'webp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF = Buffer.from('RIFF', 'latin1');
const WEBP = Buffer.from('WEBP', 'latin1');

function hasBytesAt(bytes: Buffer, offset: number, expected: Buffer): boolean {
  return bytes.subarray(offset, offset + expected.length).equals(expected);
}

/**
 * Identifies an upload by its leading bytes, never by its name or the type the client
 * claims. Nothing that is not identified here may reach sharp: sharp also opens SVG,
 * and rasterising one has no bound on its cost. Even its header read is not cheap for
 * every format it knows: to report the size of an SVG, librsvg parses the whole
 * document, which took 5.7s and 626 MB for an 18 MB file of 300,000 elements.
 */
export function detectImageFormat(bytes: Buffer): ImageFormat | null {
  if (hasBytesAt(bytes, 0, PNG_SIGNATURE)) {
    return 'png';
  }
  if (hasBytesAt(bytes, 0, JPEG_START)) {
    return 'jpeg';
  }
  if (hasBytesAt(bytes, 0, RIFF) && hasBytesAt(bytes, 8, WEBP)) {
    return 'webp';
  }
  return null;
}

/**
 * Reads an image's header without decoding its pixels. sharp's own pixel limit is
 * lifted here so that an image over ours can be refused by name rather than reported
 * as unreadable. Only call this on bytes `detectImageFormat` has identified.
 */
export function readImageHeader(bytes: Buffer): Promise<sharp.Metadata> {
  return sharp(bytes, { limitInputPixels: false }).metadata();
}

export interface AcceptedImage {
  /** The image's position in the request, from 1, for messages. */
  imageNumber: number;
  bytes: Buffer;
  format: ImageFormat;
  /** The colour space the file stores its pixels in, from its header. */
  space: sharp.Metadata['space'];
}

const FORMAT_NAMES: Record<ImageFormat, string> = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' };

function listFormats(formats: readonly ImageFormat[]): string {
  const names = formats.map((format) => FORMAT_NAMES[format]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}

/**
 * Keeps a greyscale image greyscale: by default sharp writes one out as RGB, three times
 * the samples for the same picture.
 */
export function keepGreyscale(pipeline: sharp.Sharp, { space }: AcceptedImage): sharp.Sharp {
  return space === 'b-w' ? pipeline.toColourspace('b-w') : pipeline;
}

export function damagedImageError(imageNumber: number, cause?: unknown): ClientError {
  return new ClientError(`Image ${imageNumber} is damaged or incomplete and could not be read.`, 400, { cause });
}

/**
 * Checks one upload before any of its pixels are decoded, and refuses it with a message
 * naming it: empty, not one of the `accepted` formats, or a header sharp cannot read.
 */
export async function acceptImage(
  bytes: Buffer,
  imageNumber: number,
  accepted: readonly ImageFormat[],
): Promise<AcceptedImage> {
  if (bytes.length === 0) {
    throw new ClientError(`Image ${imageNumber} is empty.`);
  }

  const format = detectImageFormat(bytes);
  if (!format || !accepted.includes(format)) {
    throw new ClientError(
      `Image ${imageNumber} is not a supported image type. Only ${listFormats(accepted)} images are accepted.`,
    );
  }

  let header: sharp.Metadata;
  try {
    header = await readImageHeader(bytes);
  } catch (error) {
    throw damagedImageError(imageNumber, error);
  }
  if (header.format !== format || !header.width || !header.height) {
    throw damagedImageError(imageNumber);
  }

  return { imageNumber, bytes, format, space: header.space };
}
