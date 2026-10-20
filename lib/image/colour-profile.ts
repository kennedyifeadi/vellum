import { deflateSync } from 'zlib';
import sharp from 'sharp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_GREY = 0;
const PNG_RGB = 2;
const RGB_LEVELS = [0, 36, 73, 109, 146, 182, 219, 255];

// Profiles that describe sRGB differ in how they were built (v2 or v4, table or
// parametric curves); converting through one of them moves a value by at most this.
const SRGB_TOLERANCE = 2;

const CRC_TABLE = Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

// Every grey level, or a cube of colours from black to white, as one row of pixels.
function chartSamples(grey: boolean): Buffer {
  if (grey) {
    return Buffer.from(Array.from({ length: 256 }, (_, level) => level));
  }
  return Buffer.from(RGB_LEVELS.flatMap((r) => RGB_LEVELS.flatMap((g) => RGB_LEVELS.flatMap((b) => [r, g, b]))));
}

// A PNG of `samples` carrying `icc` as its colour profile: the one container sharp reads
// a profile from without a file on disk.
function chartPng(samples: Buffer, grey: boolean, icc: Buffer): Buffer {
  const width = grey ? samples.length : samples.length / 3;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = grey ? PNG_GREY : PNG_RGB;
  const profile = Buffer.concat([Buffer.from('profile\0\0', 'latin1'), deflateSync(icc)]);
  const pixels = deflateSync(Buffer.concat([Buffer.from([0]), samples]));

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('iCCP', profile),
    pngChunk('IDAT', pixels),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Whether an embedded colour profile shows stored values as sRGB would, so the values
 * can be used as they are. Decided by converting a chart of colours through the profile
 * the way the image's own pixels would be, rather than by the profile's name. A profile
 * that cannot be applied counts as not sRGB, which leaves the image to its full decode.
 */
export async function profileShowsAsSrgb(icc: Buffer, grey: boolean): Promise<boolean> {
  const samples = chartSamples(grey);
  try {
    const shown = await sharp(chartPng(samples, grey, icc))
      .toColourspace(grey ? 'b-w' : 'srgb')
      .raw()
      .toBuffer();
    return shown.length === samples.length && samples.every((value, index) => Math.abs(shown[index] - value) <= SRGB_TOLERANCE);
  } catch {
    return false;
  }
}
