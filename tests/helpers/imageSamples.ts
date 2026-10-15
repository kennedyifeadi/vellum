import sharp from 'sharp';

/** The format an encoded image really is, read from its first bytes. */
export function magicFormat(bytes: Buffer): 'png' | 'jpeg' | 'webp' | 'other' {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return 'other';
}

/** The PNG header's colour type: 0 grey, 2 RGB, 3 palette, 4 grey + alpha, 6 RGBA. */
export function pngColourType(png: Buffer): number {
  return png[25];
}

export function pngHasChunk(png: Buffer, type: string): boolean {
  for (let offset = 8; offset + 8 <= png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString('latin1', offset + 4, offset + 8) === type) {
      return true;
    }
    offset += 12 + length;
  }
  return false;
}

/**
 * Smooth gradients with a little deterministic noise, so that it has tens of thousands
 * of colours and compresses like a photograph rather than like flat artwork.
 */
export function photoLikePixels(width: number, height: number): sharp.Sharp {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 7;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed >> 16) % 24;
      const offset = (y * width + x) * 3;
      pixels[offset] = Math.min(255, Math.round((x / width) * 200) + noise);
      pixels[offset + 1] = Math.min(255, Math.round((y / height) * 180) + noise);
      pixels[offset + 2] = Math.min(255, Math.round(((x + y) / (width + height)) * 220) + noise);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

export function createPhotoJpeg(width = 320, height = 240, quality = 92): Promise<Buffer> {
  return photoLikePixels(width, height).jpeg({ quality }).toBuffer();
}

export function createGradientJpeg(width = 320, height = 240): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      pixels[offset] = Math.round((x / (width - 1)) * 255);
      pixels[offset + 1] = Math.round((y / (height - 1)) * 255);
      pixels[offset + 2] = 128;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

export function flatImage(width = 40, height = 40, background = { r: 200, g: 30, b: 30 }): sharp.Sharp {
  return sharp({ create: { width, height, channels: 3, background } });
}

/** Decoded 8-bit RGB pixels, to compare two images by what they show. */
export async function rgbPixels(image: Buffer | sharp.Sharp): Promise<Buffer> {
  const pipeline = Buffer.isBuffer(image) ? sharp(image) : image;
  return pipeline.removeAlpha().toColourspace('srgb').raw().toBuffer();
}

type Colour = 'red' | 'green' | 'blue' | 'white';

const QUADRANT_COLOURS: Record<Colour, [number, number, number]> = {
  red: [220, 20, 20],
  green: [20, 200, 20],
  blue: [20, 20, 220],
  white: [250, 250, 250],
};

const UPRIGHT_WIDTH = 60;
const UPRIGHT_HEIGHT = 40;

/** What an upright picture shows in its corners, clockwise from the top left. */
export const UPRIGHT_CORNERS = { size: '60x40', corners: ['red', 'green', 'white', 'blue'] };

function uprightColourAt(x: number, y: number): [number, number, number] {
  const right = x >= UPRIGHT_WIDTH / 2;
  const bottom = y >= UPRIGHT_HEIGHT / 2;
  if (!bottom) {
    return QUADRANT_COLOURS[right ? 'green' : 'red'];
  }
  return QUADRANT_COLOURS[right ? 'white' : 'blue'];
}

// For each EXIF orientation, where the stored pixel (x, y) appears once the viewer has
// applied the tag, written from the EXIF definition of each value rather than from any
// image library.
const DISPLAYED_AT: Record<number, (x: number, y: number) => [number, number]> = {
  1: (x, y) => [x, y],
  2: (x, y) => [UPRIGHT_WIDTH - 1 - x, y],
  3: (x, y) => [UPRIGHT_WIDTH - 1 - x, UPRIGHT_HEIGHT - 1 - y],
  4: (x, y) => [x, UPRIGHT_HEIGHT - 1 - y],
  5: (x, y) => [y, x],
  6: (x, y) => [UPRIGHT_WIDTH - 1 - y, x],
  7: (x, y) => [UPRIGHT_WIDTH - 1 - y, UPRIGHT_HEIGHT - 1 - x],
  8: (x, y) => [y, UPRIGHT_HEIGHT - 1 - x],
};

/**
 * The upright 60x40 quadrant picture stored the way a camera stores it for the given
 * EXIF orientation, with that orientation tagged, so only a viewer that honours the tag
 * shows it upright.
 */
export function orientedPicture(orientation: number): sharp.Sharp {
  const sideways = orientation >= 5;
  const width = sideways ? UPRIGHT_HEIGHT : UPRIGHT_WIDTH;
  const height = sideways ? UPRIGHT_WIDTH : UPRIGHT_HEIGHT;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [displayX, displayY] = DISPLAYED_AT[orientation](x, y);
      pixels.set(uprightColourAt(displayX, displayY), (y * width + x) * 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).withMetadata({ orientation });
}

function nearestColour(r: number, g: number, b: number): Colour {
  const distance = ([cr, cg, cb]: number[]) => (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
  return (Object.keys(QUADRANT_COLOURS) as Colour[]).reduce((best, colour) =>
    distance(QUADRANT_COLOURS[colour]) < distance(QUADRANT_COLOURS[best]) ? colour : best,
  );
}

/** The size an image is stored at and the colours in its corners, ignoring any tag. */
export async function storedCorners(image: Buffer) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (fx: number, fy: number) => {
    const offset = (Math.floor(fy * info.height) * info.width + Math.floor(fx * info.width)) * 3;
    return nearestColour(data[offset], data[offset + 1], data[offset + 2]);
  };
  return {
    size: `${info.width}x${info.height}`,
    corners: [at(0.2, 0.2), at(0.8, 0.2), at(0.8, 0.8), at(0.2, 0.8)],
  };
}

/** The sRGB colour the Display P3 test patch was authored in. */
export const AUTHORED_SRGB: [number, number, number] = [200, 60, 30];

/**
 * A flat patch of `AUTHORED_SRGB`, converted to Display P3 and tagged with that
 * profile, so the numbers stored in the file differ from what a colour-managed viewer
 * shows.
 */
export function displayP3Patch(): sharp.Sharp {
  return flatImage(32, 32, { r: AUTHORED_SRGB[0], g: AUTHORED_SRGB[1], b: AUTHORED_SRGB[2] }).withIccProfile('p3');
}

const P3_TO_XYZ = [
  [0.4865709, 0.2656677, 0.1982173],
  [0.2289746, 0.6917385, 0.0792869],
  [0, 0.0451134, 1.0439444],
];
const XYZ_TO_SRGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

function multiply(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]);
}

/**
 * Display P3 numbers in sRGB by the published matrices: both spaces share the sRGB
 * transfer curve and the D65 white point.
 */
export function displayP3ToSrgb(rgb: number[]): number[] {
  const linear = rgb.map((value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return multiply(XYZ_TO_SRGB, multiply(P3_TO_XYZ, linear)).map((value) => {
    const v = Math.min(1, Math.max(0, value));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  });
}

/** The first pixel of an image as the file stores it, ignoring any embedded profile. */
export async function storedFirstPixel(image: Buffer): Promise<number[]> {
  const pixels = await sharp(image, { ignoreIcc: true }).removeAlpha().raw().toBuffer();
  return [...pixels.subarray(0, 3)];
}

export async function firstPixel(image: Buffer): Promise<number[]> {
  const pixels = await rgbPixels(image);
  return [...pixels.subarray(0, 3)];
}

/**
 * librsvg parses a whole SVG document to report its size, so even reading the "header"
 * of one like this costs seconds and hundreds of megabytes at 300,000 elements.
 */
export function createSvgWithManyElements(elementCount = 2_000): Buffer {
  const rects = Array.from(
    { length: elementCount },
    (_, index) =>
      `<rect x="${index % 2000}" y="${(index * 7) % 2000}" width="5" height="5" fill="#${(index % 4096).toString(16).padStart(3, '0')}"/>`,
  );
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000">${rects.join('')}</svg>`);
}
