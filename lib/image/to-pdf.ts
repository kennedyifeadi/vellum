import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

interface ImageToPdfOptions {
  imageBuffers: Buffer[];
}

export async function convertImagesToPdf({
  imageBuffers,
}: ImageToPdfOptions): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  for (const imageBuffer of imageBuffers) {
    let image;
    const { width, height } = await sharp(imageBuffer).metadata();

    // Embed image based on its format
    try {
      image = await pdfDoc.embedPng(imageBuffer);
    } catch (pngError) {
      try {
        image = await pdfDoc.embedJpg(imageBuffer);
      } catch (jpgError) {
        console.error('Unsupported image format:', pngError, jpgError);
        throw new Error('Unsupported image format. Only PNG and JPEG are supported.');
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