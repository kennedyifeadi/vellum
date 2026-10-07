// Runs as a worker thread started by pdf-extraction.ts. Nothing bundles or transpiles
// this file: it is loaded from disk by path, so it must stay plain JavaScript and import
// only packages from node_modules.
import { parentPort, workerData } from 'worker_threads';

// pdf.js loads the native @napi-rs/canvas addon on import to polyfill the canvas types
// its renderer uses. A worker thread that has loaded that addon takes the whole process
// down with a segfault when it exits, so pdf-extraction.ts starts this thread with
// --no-addons. Text extraction never renders; pdf.js only needs these names to exist
// while its module loads, and warns once on import that the addon is missing.
class UnavailableInWorker {}

async function loadPdfParse() {
  globalThis.DOMMatrix ??= UnavailableInWorker;
  globalThis.ImageData ??= UnavailableInWorker;
  globalThis.Path2D ??= UnavailableInWorker;

  const { warn } = console;
  console.warn = () => {};
  try {
    return await import('pdf-parse');
  } finally {
    console.warn = warn;
  }
}

async function extract({ data, maxPages }) {
  const { PDFParse } = await loadPdfParse();
  const parser = new PDFParse({ data });
  try {
    const { total } = await parser.getInfo();
    if (total > maxPages) {
      return { kind: 'page-limit', pageCount: total };
    }

    const { pages } = await parser.getText({ pageJoiner: '' });
    return { kind: 'pages', pages: pages.map(({ num, text }) => ({ num, text })) };
  } catch (error) {
    return {
      kind: 'parser-error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await parser.destroy();
  }
}

parentPort.postMessage(await extract(workerData));
