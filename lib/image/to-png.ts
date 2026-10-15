import { acceptImage, damagedImageError, openAcceptedImage, type AcceptedImage } from '@/lib/image/input';

export function acceptJpeg(bytes: Buffer, imageNumber: number): Promise<AcceptedImage> {
  return acceptImage(bytes, imageNumber, ['jpeg']);
}

/**
 * Returns a lossless PNG of what the JPEG shows, see `openAcceptedImage`. Giving `png()`
 * a quality would quantise it to at most 256 colours.
 */
export async function convertJpegToPng(jpeg: AcceptedImage): Promise<Buffer> {
  try {
    return await openAcceptedImage(jpeg).png().toBuffer();
  } catch (error) {
    throw damagedImageError(jpeg.imageNumber, error);
  }
}
