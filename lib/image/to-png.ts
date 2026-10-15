import sharp from 'sharp';
import { acceptImage, damagedImageError, keepGreyscale, type AcceptedImage } from '@/lib/image/input';

export function acceptJpeg(bytes: Buffer, imageNumber: number): Promise<AcceptedImage> {
  return acceptImage(bytes, imageNumber, ['jpeg']);
}

/**
 * Returns a lossless true-colour PNG of what the JPEG shows: turned upright from its EXIF
 * orientation, and in sRGB, which sharp converts any embedded profile to, or greyscale if
 * the JPEG is. Giving `png()` a quality would quantise it to at most 256 colours. No
 * metadata is carried over.
 */
export async function convertJpegToPng(jpeg: AcceptedImage): Promise<Buffer> {
  try {
    return await keepGreyscale(sharp(jpeg.bytes).rotate(), jpeg).png().toBuffer();
  } catch (error) {
    throw damagedImageError(jpeg.imageNumber, error);
  }
}
