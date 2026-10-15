import sharp from 'sharp';

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
