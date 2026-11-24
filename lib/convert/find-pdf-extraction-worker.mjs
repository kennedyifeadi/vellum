// Runs as a worker thread started by find-pdf-extraction.ts. Nothing bundles or
// transpiles this file: it is loaded from disk by path, so it must stay plain JavaScript
// and import only packages from node_modules and plain JavaScript files beside it.
import { parentPort, workerData } from 'worker_threads';
import { importWithoutCanvas, toParserErrorMessage } from './pdf-worker-runtime.mjs';

function toTextItem({ str, hasEOL, width, height, transform }) {
  return { str, hasEOL, width, height, transform };
}

async function extract({ data, maxPages }) {
  const pdfjs = await importWithoutCanvas(() => import('pdfjs-dist/legacy/build/pdf.mjs'));
  let loadingTask;
  try {
    loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > maxPages) {
      return { kind: 'page-limit', pageCount: pdf.numPages };
    }

    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const { items } = await page.getTextContent();
      // pdf.js yields TextItem | TextMarkedContent; only the former carries `str`.
      pages.push(items.filter((item) => typeof item.str === 'string').map(toTextItem));
    }
    return { kind: 'text-items', pages };
  } catch (error) {
    return toParserErrorMessage(error);
  } finally {
    await loadingTask?.destroy();
  }
}

parentPort.postMessage(await extract(workerData));
