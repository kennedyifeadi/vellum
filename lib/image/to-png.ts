import sharp from 'sharp';

interface JpegToPngOptions {
  jpegBuffer: Buffer;
}

export async function convertJpegToPng({
  jpegBuffer,
}: JpegToPngOptions): Promise<Buffer> {
  return sharp(jpegBuffer).png().toBuffer();
}