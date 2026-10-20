type Rgba = [number, number, number, number];

export interface BmpOptions {
  width: number;
  height: number;
  /** The colour at (x, y), from the top left. Alpha is used only with `alpha`. */
  pixel: (x: number, y: number) => Rgba;
  bitsPerPixel: 1 | 4 | 8 | 24 | 32;
  /** Rows stored top row first, which a negative height announces. */
  topDown?: boolean;
  /** Run-length encode an 8-bit image. */
  runLength?: boolean;
  /** A 32-bit image with an alpha channel, in a V5 header with bit masks. */
  alpha?: boolean;
  pixelsPerMetre?: number;
}

const FILE_HEADER_SIZE = 14;
const INFO_HEADER_SIZE = 40;
const V5_HEADER_SIZE = 124;

function rowStride(width: number, bitsPerPixel: number): number {
  return Math.ceil((width * bitsPerPixel) / 32) * 4;
}

function paletteOf(options: BmpOptions): Rgba[] {
  const colours = new Map<string, Rgba>();
  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) {
      const colour = options.pixel(x, y);
      colours.set(colour.slice(0, 3).join(), colour);
    }
  }
  const palette = [...colours.values()];
  if (palette.length > 2 ** options.bitsPerPixel) {
    throw new Error(`${palette.length} colours do not fit a ${options.bitsPerPixel}-bit palette`);
  }
  return palette;
}

function storedRowOrder({ height, topDown }: BmpOptions): number[] {
  const rows = Array.from({ length: height }, (_, row) => row);
  return topDown ? rows : rows.reverse();
}

function packedRow(options: BmpOptions, y: number, indexOf: (colour: Rgba) => number): Buffer {
  const { width, bitsPerPixel } = options;
  const row = Buffer.alloc(rowStride(width, bitsPerPixel));
  for (let x = 0; x < width; x++) {
    const colour = options.pixel(x, y);
    if (bitsPerPixel === 24 || bitsPerPixel === 32) {
      const [r, g, b, a] = colour;
      row.set(bitsPerPixel === 24 ? [b, g, r] : [b, g, r, options.alpha ? a : 0], (x * bitsPerPixel) / 8);
    } else {
      const bitOffset = x * bitsPerPixel;
      row[bitOffset >> 3] |= indexOf(colour) << (8 - bitsPerPixel - (bitOffset & 7));
    }
  }
  return row;
}

// RLE8 as Windows writes it: runs of one index, each row ended by 0 0, the image by 0 1.
function runLengthRow(options: BmpOptions, y: number, indexOf: (colour: Rgba) => number): Buffer {
  const bytes: number[] = [];
  for (let x = 0; x < options.width; ) {
    const index = indexOf(options.pixel(x, y));
    let run = 1;
    while (x + run < options.width && run < 255 && indexOf(options.pixel(x + run, y)) === index) {
      run += 1;
    }
    bytes.push(run, index);
    x += run;
  }
  bytes.push(0, 0);
  return Buffer.from(bytes);
}

/** A BMP of the picture `pixel` draws, in the layout the options ask for. */
export function createBmp(options: BmpOptions): Buffer {
  const { width, height, bitsPerPixel, alpha } = options;
  const palette = bitsPerPixel <= 8 ? paletteOf(options) : [];
  const indexOf = (colour: Rgba) => palette.findIndex((entry) => entry.slice(0, 3).join() === colour.slice(0, 3).join());

  const rows = storedRowOrder(options).map((y) =>
    options.runLength ? runLengthRow(options, y, indexOf) : packedRow(options, y, indexOf),
  );
  const pixelData = Buffer.concat(options.runLength ? [...rows, Buffer.from([0, 1])] : rows);

  const headerSize = alpha ? V5_HEADER_SIZE : INFO_HEADER_SIZE;
  const colourTable = Buffer.alloc(palette.length * 4);
  palette.forEach(([r, g, b], index) => colourTable.set([b, g, r, 0], index * 4));
  const pixelDataOffset = FILE_HEADER_SIZE + headerSize + colourTable.length;

  const headers = Buffer.alloc(FILE_HEADER_SIZE + headerSize);
  headers.write('BM', 0, 'latin1');
  headers.writeUInt32LE(pixelDataOffset + pixelData.length, 2);
  headers.writeUInt32LE(pixelDataOffset, 10);
  headers.writeUInt32LE(headerSize, 14);
  headers.writeInt32LE(width, 18);
  headers.writeInt32LE(options.topDown ? -height : height, 22);
  headers.writeUInt16LE(1, 26);
  headers.writeUInt16LE(bitsPerPixel, 28);
  headers.writeUInt32LE(options.runLength ? 1 : alpha ? 3 : 0, 30);
  headers.writeUInt32LE(pixelData.length, 34);
  headers.writeInt32LE(options.pixelsPerMetre ?? 2835, 38);
  headers.writeInt32LE(options.pixelsPerMetre ?? 2835, 42);
  headers.writeUInt32LE(palette.length, 46);
  if (alpha) {
    headers.writeUInt32LE(0x00ff0000, 54);
    headers.writeUInt32LE(0x0000ff00, 58);
    headers.writeUInt32LE(0x000000ff, 62);
    headers.writeUInt32LE(0xff000000, 66);
    headers.write('BGRs', 70, 'latin1');
  }

  return Buffer.concat([headers, colourTable, pixelData]);
}

/** The picture `pixel` draws as raw RGB, or RGBA with `alpha`, top row first. */
export function expectedBmpPixels({ width, height, pixel }: BmpOptions, alpha = false): Buffer {
  const channels = alpha ? 4 : 3;
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.set(pixel(x, y).slice(0, channels), (y * width + x) * channels);
    }
  }
  return pixels;
}
