import sharp from 'sharp';
import { convertJpegToPng } from '../lib/image/to-png';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function createJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();
}

describe('convertJpegToPng (lib/image/to-png.ts)', () => {
  it('converts a JPEG buffer into a valid PNG with the same dimensions', async () => {
    const jpeg = await createJpeg(120, 80);

    const pngBuffer = await convertJpegToPng({ jpegBuffer: jpeg });

    expect(pngBuffer.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const metadata = await sharp(pngBuffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(120);
    expect(metadata.height).toBe(80);
  });

  it('also accepts a PNG input and returns an equivalent PNG', async () => {
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();

    const result = await convertJpegToPng({ jpegBuffer: png });

    expect(result.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('rejects a buffer that is not a valid image', async () => {
    const garbage = Buffer.from('this is definitely not an image');

    await expect(convertJpegToPng({ jpegBuffer: garbage })).rejects.toThrow();
  });
});
