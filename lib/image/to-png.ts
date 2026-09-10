import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';

interface JpegToPngOptions {
  jpegBuffer: Buffer;
  quality?: number;
}

export async function convertJpegToPng({
  jpegBuffer,
  quality,
}: JpegToPngOptions): Promise<Buffer> {
  if (!jpegBuffer || jpegBuffer.length === 0) {
    throw new ClientError('The image file is empty.');
  }

  try {
    const pipeline = sharp(jpegBuffer);
    return await (quality != null ? pipeline.png({ quality }) : pipeline.png()).toBuffer();
  } catch (error) {
    throw new ClientError("That doesn't look like a valid image.", 400, { cause: error });
  }
}
