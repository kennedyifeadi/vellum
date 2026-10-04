import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';

interface CompressImageOptions {
  imageBuffer: Buffer;
  quality: number;
}

export async function compressImage({
  imageBuffer,
  quality,
}: CompressImageOptions): Promise<Buffer> {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new ClientError('The image file is empty.');
  }

  try {
    return await sharp(imageBuffer)
      .jpeg({ quality, mozjpeg: true })
      .png({ quality: quality - 10, palette: true })
      .webp({ quality })
      .toBuffer();
  } catch (error) {
    throw new ClientError("That doesn't look like a valid image.", 400, { cause: error });
  }
}
