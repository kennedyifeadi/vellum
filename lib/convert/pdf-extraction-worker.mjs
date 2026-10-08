// Runs as a worker thread started by pdf-extraction.ts. Nothing bundles or transpiles
// this file: it is loaded from disk by path, so it must stay plain JavaScript and import
// only packages from node_modules and plain JavaScript files beside it.
import { parentPort, workerData } from 'worker_threads';
import { importWithoutCanvas, toParserErrorMessage } from './pdf-worker-runtime.mjs';

async function extract({ data, maxPages }) {
  const { PDFParse } = await importWithoutCanvas(() => import('pdf-parse'));
  const parser = new PDFParse({ data });
  try {
    const { total } = await parser.getInfo();
    if (total > maxPages) {
      return { kind: 'page-limit', pageCount: total };
    }

    const { pages } = await parser.getText({ pageJoiner: '' });
    return { kind: 'pages', pages: pages.map(({ num, text }) => ({ num, text })) };
  } catch (error) {
    return toParserErrorMessage(error);
  } finally {
    await parser.destroy();
  }
}

parentPort.postMessage(await extract(workerData));
