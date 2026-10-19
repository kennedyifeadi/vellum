// Runs as a worker thread started by to-pdf.ts. Nothing bundles or transpiles this file:
// it is loaded from disk by path, so it must stay plain JavaScript and import only
// packages from node_modules.
import { parentPort, workerData } from 'worker_threads';
// The single-file build of the same release. Every conversion starts a worker and loads
// pdf-lib in it; this file loads in about 0.2s where the package's 139-file entry point
// took 1.5s, and it writes byte-identical PDFs.
import pdfLib from 'pdf-lib/dist/pdf-lib.min.js';

const { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } = pdfLib;

// pdf-lib only reads the JPEG's markers here; the bytes go into the PDF as they are.
async function embedJpeg(pdfDoc, bytes) {
  try {
    const image = await pdfDoc.embedJpg(bytes);
    await image.embed();
    return image.ref;
  } catch {
    return undefined;
  }
}

function imageDictionary({ colours, bitsPerComponent }, width, height) {
  return {
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    ColorSpace: colours === 1 ? 'DeviceGray' : 'DeviceRGB',
    BitsPerComponent: bitsPerComponent,
    Filter: 'FlateDecode',
    DecodeParms: { Predictor: 15, Colors: colours, BitsPerComponent: bitsPerComponent, Columns: width },
  };
}

// The streams arrive compressed and filtered as PNG rows, which FlateDecode with a PNG
// predictor reads directly, so they are stored without being touched.
function embedPixels(pdfDoc, { width, height, colour, alpha }) {
  const { context } = pdfDoc;
  const softMask = alpha && context.register(context.stream(alpha.data, imageDictionary(alpha, width, height)));
  const dictionary = imageDictionary(colour, width, height);
  return context.register(context.stream(colour.data, softMask ? { ...dictionary, SMask: softMask } : dictionary));
}

function drawOnNewPage(pdfDoc, imageRef, { width, height, matrix }) {
  const page = pdfDoc.addPage([width, height]);
  const name = page.node.newXObject('Image', imageRef);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix), drawObject(name), popGraphicsState());
}

async function convert(pages) {
  const pdfDoc = await PDFDocument.create();

  for (const page of pages) {
    const imageRef = page.kind === 'jpeg' ? await embedJpeg(pdfDoc, page.bytes) : embedPixels(pdfDoc, page);
    if (!imageRef) {
      return { kind: 'unreadable-jpeg', imageNumber: page.imageNumber };
    }
    drawOnNewPage(pdfDoc, imageRef, page.layout);
  }

  return { kind: 'pdf', bytes: await pdfDoc.save() };
}

const result = await convert(workerData.pages);
parentPort.postMessage(result, result.kind === 'pdf' ? [result.bytes.buffer] : []);
