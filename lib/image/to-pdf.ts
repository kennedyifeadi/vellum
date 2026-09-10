import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';

interface ImageToPdfOptions {
  imageBuffers: Buffer[];
}

export async function convertImagesToPdf({
  imageBuffers,
}: ImageToPdfOptions): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  for (const [index, imageBuffer] of imageBuffers.entries()) {
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new ClientError(`Image ${index + 1} is empty.`);
    }

    let image;
    let width: number | undefined;
    let height: number | undefined;
    try {
      ({ width, height } = await sharp(imageBuffer).metadata());
    } catch (error) {
      throw new ClientError(
        `Image ${index + 1} is not a valid image or is corrupted.`,
        400,
        { cause: error },
      );
    }

    // Embed image based on its format
    try {
      image = await pdfDoc.embedPng(imageBuffer);
    } catch {
      try {
        image = await pdfDoc.embedJpg(imageBuffer);
      } catch {
        throw new ClientError('Unsupported image format. Only PNG and JPEG are supported.');
      }
    }

    const page = pdfDoc.addPage();

    // Calculate dimensions to fit the page while maintaining aspect ratio
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    const scaleFactor = Math.min(pageWidth / width!, pageHeight / height!);
    const scaledWidth = width! * scaleFactor;
    const scaledHeight = height! * scaleFactor;

    const x = (pageWidth - scaledWidth) / 2;
    const y = (pageHeight - scaledHeight) / 2;

    page.drawImage(image, {
      x,
      y,
      width: scaledWidth,
      height: scaledHeight,
    });
  }

  return Buffer.from(await pdfDoc.save());
}