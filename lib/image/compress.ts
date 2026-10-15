import sharp from 'sharp';
import {
  acceptImage,
  damagedImageError,
  openAcceptedImage,
  type AcceptedImage,
  type ImageFormat,
} from '@/lib/image/input';

export type CompressionLevel = 'low' | 'medium' | 'high';

const LEVELS: readonly CompressionLevel[] = ['low', 'medium', 'high'];

// From the best quality to the smallest file.
const QUALITY: Record<CompressionLevel, number> = { low: 90, medium: 80, high: 60 };

// PNG has no lossy mode of its own: `low` re-encodes losslessly, and the other two
// reduce the image to a palette, which keeps transparency. A palette quality alone
// barely changes the size of a photo, so `high` also allows fewer colours.
const PNG_OPTIONS: Record<CompressionLevel, sharp.PngOptions> = {
  low: { compressionLevel: 9, adaptiveFiltering: true },
  medium: { compressionLevel: 9, palette: true, quality: 80 },
  high: { compressionLevel: 9, palette: true, quality: 60, colours: 64 },
};

export const CONTENT_TYPES: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const FILE_EXTENSIONS: Record<ImageFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/** The level a request asks for; anything not recognised is `medium`. */
export function compressionLevel(value: unknown): CompressionLevel {
  return LEVELS.find((level) => level === value) ?? 'medium';
}

export function acceptImageToCompress(bytes: Buffer, imageNumber: number): Promise<AcceptedImage> {
  return acceptImage(bytes, imageNumber, ['jpeg', 'png', 'webp']);
}

function encodePng(pipeline: sharp.Sharp, image: AcceptedImage, level: CompressionLevel): sharp.Sharp {
  // Lossless means keeping all 16 bits of a 16-bit PNG, which sharp otherwise reduces to 8.
  if (level === 'low' && image.depth === 'ushort') {
    pipeline.toColourspace(image.space === 'grey16' ? 'grey16' : 'rgb16');
  }
  return pipeline.png(PNG_OPTIONS[level]);
}

function encode(image: AcceptedImage, level: CompressionLevel): sharp.Sharp {
  const pipeline = openAcceptedImage(image);
  switch (image.format) {
    case 'jpeg':
      return pipeline.jpeg({ quality: QUALITY[level], mozjpeg: true });
    case 'webp':
      return pipeline.webp({ quality: QUALITY[level] });
    case 'png':
      return encodePng(pipeline, image, level);
  }
}

/**
 * Re-encodes an image in its own format at `level`, see `openAcceptedImage` for what it
 * keeps. When that does not make it smaller, returns the uploaded bytes unchanged:
 * already optimised images, flat artwork and tiny files often grow when re-encoded.
 */
export async function compressImage(image: AcceptedImage, level: CompressionLevel): Promise<Buffer> {
  let compressed: Buffer;
  try {
    compressed = await encode(image, level).toBuffer();
  } catch (error) {
    throw damagedImageError(image.imageNumber, error);
  }
  return compressed.length < image.bytes.length ? compressed : image.bytes;
}
