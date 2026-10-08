import { crc32, deflateSync } from 'zlib';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from 'pdf-lib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NOT_ZLIB = Buffer.from('not zlib at all');

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}

function header(width: number, height: number): Buffer {
  const fields = Buffer.alloc(13);
  fields.writeUInt32BE(width, 0);
  fields.writeUInt32BE(height, 4);
  fields[8] = 8; // bit depth
  fields[9] = 2; // colour type: RGB
  return chunk('IHDR', fields);
}

function frameControl(sequenceNumber: number, width: number, height: number): Buffer {
  const fields = Buffer.alloc(26);
  fields.writeUInt32BE(sequenceNumber, 0);
  fields.writeUInt32BE(width, 4);
  fields.writeUInt32BE(height, 8);
  fields.writeUInt16BE(1, 20);
  fields.writeUInt16BE(10, 22);
  return chunk('fcTL', fields);
}

/**
 * A PNG with a valid signature and header whose pixel data is not a zlib stream. At
 * 10x10 it is the 72-byte file that pdf-lib never returns from (#98).
 */
export function createPngWithUnreadablePixels(width = 10, height = 10): Buffer {
  return Buffer.concat([PNG_SIGNATURE, header(width, height), chunk('IDAT', NOT_ZLIB), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * A 10x10 PNG with a second animation frame. An image decoder reads the still image and
 * accepts it; pdf-lib decodes the frames too, and refuses an animated PNG.
 */
export function createAnimatedPng(secondFrameData?: Buffer): Buffer {
  const size = 10;
  const blackRows = Buffer.alloc(size * (1 + size * 3));
  const animationControl = Buffer.alloc(8);
  animationControl.writeUInt32BE(2, 0);
  const sequenceNumber = Buffer.from([0, 0, 0, 2]);

  return Buffer.concat([
    PNG_SIGNATURE,
    header(size, size),
    chunk('acTL', animationControl),
    frameControl(0, size, size),
    chunk('IDAT', deflateSync(blackRows)),
    frameControl(1, size, size),
    chunk('fdAT', Buffer.concat([sequenceNumber, secondFrameData ?? deflateSync(blackRows)])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * An animated PNG whose still image is valid and whose second frame is not a zlib
 * stream. pdf-lib never returns from it, which makes it a conversion only a deadline
 * can stop.
 */
export function createPngThatHangsPdfLib(): Buffer {
  return createAnimatedPng(NOT_ZLIB);
}

/**
 * A 233-byte SVG that an image decoder reads the size of at once and then spends minutes
 * rasterising: fractal noise blurred over 49 megapixels, just under the pixel limit.
 */
export function createSvgThatTakesMinutesToRender(): string {
  const size = 7000;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="f">` +
    '<feTurbulence baseFrequency="0.9" numOctaves="8"/><feGaussianBlur stdDeviation="60"/></filter>' +
    `<rect width="${size}" height="${size}" filter="url(#f)"/></svg>`
  );
}

export interface PdfPageImage {
  pageWidth: number;
  pageHeight: number;
  /** Where the page's content stream places the image, in points. */
  placement: { x: number; y: number; width: number; height: number };
  pixelWidth: number;
  pixelHeight: number;
  filter: string;
  /** The image stream exactly as stored in the PDF. */
  storedBytes: Buffer;
  /** The stream decoded: RGB samples for an image pdf-lib stored from a PNG. */
  decodedBytes: Buffer;
  /** The decoded soft mask, when the image has transparency. */
  alpha?: Buffer;
}

function numberAt(dict: PDFDict, key: string): number {
  return dict.lookup(PDFName.of(key), PDFNumber).asNumber();
}

function readPlacement(contentStream: string): PdfPageImage['placement'] {
  const matrices = [...contentStream.matchAll(/((?:-?[\d.]+(?:e-?\d+)?\s+){6})cm/g)].map((match) =>
    match[1].trim().split(/\s+/).map(Number),
  );
  // pdf-lib writes four matrices for an image: translate, rotate, scale, skew.
  const [, , , , x, y] = matrices[0];
  const [width, , , height] = matrices[2];
  return { x, y, width, height };
}

function readContentStream(doc: PDFDocument, contents: unknown): string {
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams
    .map((stream) => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString('latin1'))
    .join('\n');
}

/** Reads back, page by page, the one image each page of a converted PDF carries. */
export async function readPdfPageImages(pdf: Buffer): Promise<PdfPageImage[]> {
  const doc = await PDFDocument.load(pdf);

  return doc.getPages().map((page) => {
    const xObjects = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const [[, imageRef]] = xObjects.entries();
    const image = doc.context.lookup(imageRef, PDFStream) as PDFRawStream;
    const filter = image.dict.lookup(PDFName.of('Filter'), PDFName).asString().slice(1);
    const softMaskRef = image.dict.get(PDFName.of('SMask'));

    return {
      pageWidth: page.getWidth(),
      pageHeight: page.getHeight(),
      placement: readPlacement(readContentStream(doc, page.node.Contents())),
      pixelWidth: numberAt(image.dict, 'Width'),
      pixelHeight: numberAt(image.dict, 'Height'),
      filter,
      storedBytes: Buffer.from(image.contents),
      decodedBytes: filter === 'FlateDecode' ? Buffer.from(decodePDFRawStream(image).decode()) : Buffer.from(image.contents),
      alpha:
        softMaskRef instanceof PDFRef
          ? Buffer.from(decodePDFRawStream(doc.context.lookup(softMaskRef, PDFStream) as PDFRawStream).decode())
          : undefined,
    };
  });
}
