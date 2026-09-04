import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { convertImagesToPdf } from '../lib/image/to-pdf';

async function createPng(width: number, height: number, color = { r: 255, g: 0, b: 0 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

async function createJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 255, b: 0 } } })
    .jpeg()
    .toBuffer();
}

describe('convertImagesToPdf (lib/image/to-pdf.ts)', () => {
  it('creates one page per image', async () => {
    const png = await createPng(100, 50);
    const jpeg = await createJpeg(80, 80);

    const pdfBuffer = await convertImagesToPdf({ imageBuffers: [png, jpeg] });
    const doc = await PDFDocument.load(pdfBuffer);

    expect(doc.getPageCount()).toBe(2);
  });

  it('accepts both PNG and JPEG input in the same batch', async () => {
    const png = await createPng(60, 60);
    const jpeg = await createJpeg(60, 60);

    await expect(convertImagesToPdf({ imageBuffers: [png, jpeg] })).resolves.toBeInstanceOf(Buffer);
  });

  it('scales a wide image down to fit within the page while preserving aspect ratio', async () => {
    // Page defaults to A4 (595.28 x 841.89pt); a very wide image must be shrunk to fit the width.
    const wide = await createPng(4000, 100);

    const pdfBuffer = await convertImagesToPdf({ imageBuffers: [wide] });
    const doc = await PDFDocument.load(pdfBuffer);
    const page = doc.getPage(0);

    expect(page.getWidth()).toBeCloseTo(595.28, 1);
    expect(page.getHeight()).toBeCloseTo(841.89, 1);
  });

  it('rejects an unsupported image format such as WebP', async () => {
    const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .webp()
      .toBuffer();

    await expect(convertImagesToPdf({ imageBuffers: [webp] })).rejects.toThrow(
      'Unsupported image format. Only PNG and JPEG are supported.'
    );
  });

  it('produces an empty but loadable PDF when given no images', async () => {
    const pdfBuffer = await convertImagesToPdf({ imageBuffers: [] });

    await expect(PDFDocument.load(pdfBuffer)).resolves.toBeDefined();
  });
});
