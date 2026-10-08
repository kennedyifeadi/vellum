import path from 'path';
import sharp from 'sharp';
import { ClientError } from '@/lib/convert/errors';
import { assertPixelCountWithinLimit, MAX_IMAGE_PIXELS } from '@/lib/convert/image-to-pdf-limits';
import { runWorkerJob, type WorkerLimits } from '@/lib/convert/worker-job';

const WORKER_PATH = path.join(process.cwd(), 'lib', 'image', 'to-pdf-worker.mjs');

interface ImageToPdfOptions {
  imageBuffers: Buffer[];
  limits: WorkerLimits;
}

interface ValidatedImage {
  bytes: Buffer;
  width: number;
  height: number;
}

// What sharp detects from the content, whatever the file is called. Nothing else may
// reach a decode: sharp also opens SVG, and rasterising one has no bound on its cost.
const SUPPORTED_FORMATS: (string | undefined)[] = ['png', 'jpeg'];

function unsupportedFormatError(): ClientError {
  return new ClientError('Unsupported image format. Only PNG and JPEG are supported.');
}

function corruptedImageError(imageNumber: number, cause?: unknown): ClientError {
  return new ClientError(`Image ${imageNumber} is not a valid image or is corrupted.`, 400, { cause });
}

async function readHeader(imageBuffer: Buffer, imageNumber: number) {
  try {
    // sharp's own pixel limit is lifted for this header-only read, so that an image over
    // ours is refused by name rather than reported as corrupted.
    return await sharp(imageBuffer, { limitInputPixels: false }).metadata();
  } catch (error) {
    throw corruptedImageError(imageNumber, error);
  }
}

// pdf-lib decodes a PNG in JavaScript and never returns from one whose pixel data is not
// a zlib stream (#98). libvips refuses such a file in milliseconds, on its own threads.
// Reducing to a single pixel makes it read every row without holding the decoded image.
async function assertPngDecodes(imageBuffer: Buffer, imageNumber: number): Promise<void> {
  try {
    await sharp(imageBuffer, { limitInputPixels: MAX_IMAGE_PIXELS }).resize(1, 1, { fit: 'fill' }).raw().toBuffer();
  } catch (error) {
    throw corruptedImageError(imageNumber, error);
  }
}

async function validateImage(imageBuffer: Buffer, imageNumber: number): Promise<ValidatedImage> {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new ClientError(`Image ${imageNumber} is empty.`);
  }

  const { format, width, height } = await readHeader(imageBuffer, imageNumber);
  if (!SUPPORTED_FORMATS.includes(format)) {
    throw unsupportedFormatError();
  }
  if (!width || !height) {
    throw corruptedImageError(imageNumber);
  }
  assertPixelCountWithinLimit(imageNumber, width, height);
  if (format === 'png') {
    await assertPngDecodes(imageBuffer, imageNumber);
  }

  return { bytes: imageBuffer, width, height };
}

function readPdf(message: unknown): Buffer {
  const result = message as { kind?: unknown; bytes?: unknown } | null;

  if (result?.kind === 'unsupported-format') {
    throw unsupportedFormatError();
  }
  if (result?.kind === 'pdf' && ArrayBuffer.isView(result.bytes)) {
    const { buffer, byteOffset, byteLength } = result.bytes;
    return Buffer.from(buffer, byteOffset, byteLength);
  }
  throw new Error('Image to PDF worker returned an unexpected result');
}

/**
 * Builds a PDF with one page per image. Every image is validated here first; pdf-lib
 * then embeds the original bytes in a worker thread, see `runWorkerJob` for how that
 * is bounded and how it fails.
 */
export async function convertImagesToPdf({ imageBuffers, limits }: ImageToPdfOptions): Promise<Buffer> {
  const images: ValidatedImage[] = [];
  for (const [index, imageBuffer] of imageBuffers.entries()) {
    images.push(await validateImage(imageBuffer, index + 1));
  }

  return runWorkerJob({
    name: 'Image to PDF conversion',
    workerPath: WORKER_PATH,
    workerData: { images },
    limits,
    readMessage: readPdf,
  });
}
