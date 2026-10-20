import { crc32, deflateSync } from 'zlib';
import sharp from 'sharp';
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
 * rasterising: fractal noise blurred over the whole canvas, by default 49 megapixels,
 * just under the pixel limit.
 */
export function createSvgThatTakesMinutesToRender(size = 7000): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="f">` +
    '<feTurbulence baseFrequency="0.9" numOctaves="8"/><feGaussianBlur stdDeviation="60"/></filter>' +
    `<rect width="${size}" height="${size}" filter="url(#f)"/></svg>`
  );
}

export interface PdfPageImage {
  pageWidth: number;
  pageHeight: number;
  /** The transformation matrix the page's content stream draws the image with. */
  matrix: number[];
  /** The box that matrix maps the image onto, in points. */
  placement: { x: number; y: number; width: number; height: number };
  pixelWidth: number;
  pixelHeight: number;
  filter: string;
  colourSpace: string;
  bitsPerComponent: number;
  /** The image stream exactly as stored in the PDF. */
  storedBytes: Buffer;
  /** The samples the stream decodes to; 16-bit samples in the machine's byte order. */
  decodedBytes: Buffer;
  /** The decoded soft mask, when the image has transparency. */
  alpha?: Buffer;
}

function numberAt(dict: PDFDict, key: string): number {
  return dict.lookup(PDFName.of(key), PDFNumber).asNumber();
}

function readMatrix(contentStream: string): number[] {
  const [match] = contentStream.matchAll(/((?:-?[\d.]+(?:e-?\d+)?\s+){6})cm/g);
  return match[1].trim().split(/\s+/).map(Number);
}

function boxOf([a, b, c, d, e, f]: number[]): PdfPageImage['placement'] {
  const xs = [e, e + a, e + c, e + a + c];
  const ys = [f, f + b, f + d, f + b + d];
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function readContentStream(doc: PDFDocument, contents: unknown): string {
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams
    .map((stream) => Buffer.from(decodePDFRawStream(stream as PDFRawStream).decode()).toString('latin1'))
    .join('\n');
}

// A stream stored with a PNG predictor holds a PNG's filtered rows, so wrapping it in a
// PNG header lets an image decoder undo the filters.
async function decodeImageStream(image: PDFRawStream): Promise<Buffer> {
  const filter = image.dict.lookup(PDFName.of('Filter'), PDFName).asString();
  if (filter !== '/FlateDecode') {
    return Buffer.from(image.contents);
  }
  const parameters = image.dict.lookup(PDFName.of('DecodeParms'));
  if (!(parameters instanceof PDFDict) || numberAt(parameters, 'Predictor') < 10) {
    return Buffer.from(decodePDFRawStream(image).decode());
  }
  const fields = Buffer.alloc(13);
  fields.writeUInt32BE(numberAt(image.dict, 'Width'), 0);
  fields.writeUInt32BE(numberAt(image.dict, 'Height'), 4);
  fields[8] = numberAt(parameters, 'BitsPerComponent');
  fields[9] = numberAt(parameters, 'Colors') === 1 ? 0 : 2;
  const png = Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', fields),
    chunk('IDAT', Buffer.from(image.contents)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  // sharp writes out every image as RGB unless told otherwise.
  const decoder = fields[9] === 0 ? sharp(png).extractChannel(0) : sharp(png);
  return decoder.raw({ depth: fields[8] === 16 ? 'ushort' : 'uchar' }).toBuffer();
}

/** Reads back, page by page, the one image each page of a converted PDF carries. */
export async function readPdfPageImages(pdf: Buffer): Promise<PdfPageImage[]> {
  const doc = await PDFDocument.load(pdf);

  return Promise.all(
    doc.getPages().map(async (page) => {
      const xObjects = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
      const [[, imageRef]] = xObjects.entries();
      const image = doc.context.lookup(imageRef, PDFStream) as PDFRawStream;
      const softMaskRef = image.dict.get(PDFName.of('SMask'));
      const matrix = readMatrix(readContentStream(doc, page.node.Contents()));

      return {
        pageWidth: page.getWidth(),
        pageHeight: page.getHeight(),
        matrix,
        placement: boxOf(matrix),
        pixelWidth: numberAt(image.dict, 'Width'),
        pixelHeight: numberAt(image.dict, 'Height'),
        filter: image.dict.lookup(PDFName.of('Filter'), PDFName).asString().slice(1),
        colourSpace: image.dict.lookup(PDFName.of('ColorSpace'), PDFName).asString().slice(1),
        bitsPerComponent: numberAt(image.dict, 'BitsPerComponent'),
        storedBytes: Buffer.from(image.contents),
        decodedBytes: await decodeImageStream(image),
        alpha:
          softMaskRef instanceof PDFRef
            ? await decodeImageStream(doc.context.lookup(softMaskRef, PDFStream) as PDFRawStream)
            : undefined,
      };
    }),
  );
}
