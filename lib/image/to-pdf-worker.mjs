// Runs as a worker thread started by to-pdf.ts. Nothing bundles or transpiles this file:
// it is loaded from disk by path, so it must stay plain JavaScript and import only
// packages from node_modules.
import { parentPort, workerData } from 'worker_threads';
// The single-file build of the same release. Every conversion starts a worker and loads
// pdf-lib in it; this file loads in about 0.2s where the package's 139-file entry point
// took 1.5s, and it writes byte-identical PDFs.
import pdfLib from 'pdf-lib/dist/pdf-lib.min.js';

const { PDFDocument } = pdfLib;

async function embed(pdfDoc, bytes) {
  try {
    return await pdfDoc.embedPng(bytes);
  } catch {
    try {
      return await pdfDoc.embedJpg(bytes);
    } catch {
      return undefined;
    }
  }
}

function drawCentredOnNewPage(pdfDoc, image, width, height) {
  const page = pdfDoc.addPage();
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();

  const scaleFactor = Math.min(pageWidth / width, pageHeight / height);
  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;

  page.drawImage(image, {
    x: (pageWidth - scaledWidth) / 2,
    y: (pageHeight - scaledHeight) / 2,
    width: scaledWidth,
    height: scaledHeight,
  });
}

async function convert(images) {
  const pdfDoc = await PDFDocument.create();

  for (const { bytes, width, height } of images) {
    const image = await embed(pdfDoc, bytes);
    if (!image) {
      return { kind: 'unsupported-format' };
    }
    // Left to `save`, pdf-lib keeps every PNG's decoded pixels until the end, so memory
    // grows with the whole request. Embedding now compresses them and lets them go: the
    // peak is that of one image, about 520 MB for a PNG at the pixel cap.
    await image.embed();
    drawCentredOnNewPage(pdfDoc, image, width, height);
  }

  return { kind: 'pdf', bytes: await pdfDoc.save() };
}

const result = await convert(workerData.images);
parentPort.postMessage(result, result.kind === 'pdf' ? [result.bytes.buffer] : []);
