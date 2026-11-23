import path from 'path';
import { pathToFileURL } from 'url';
import { Worker } from 'worker_threads';

const ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(ROOT, 'lib', 'convert', 'find-pdf-extraction-worker.mjs');
const RECORDED_PDFJS = pathToFileURL(path.join(__dirname, 'helpers', 'recordedPdfjs', 'register.mjs')).href;

jest.setTimeout(60_000);

// The options the Find in PDF worker opens a document with, read back from a pdf.js
// stand-in that refuses the document with them.
function documentOptions(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, {
      workerData: { data: new Uint8Array([0x25, 0x50, 0x44, 0x46]), maxPages: 1 },
      execArgv: ['--no-addons', '--import', RECORDED_PDFJS],
    });
    worker.once('message', (message: { kind: string; name: string; message: string }) => {
      if (message.kind === 'parser-error' && message.name === 'RecordedOptions') {
        resolve(JSON.parse(message.message));
      } else {
        reject(new Error(`Unexpected reply from the worker: ${JSON.stringify(message)}`));
      }
    });
    worker.once('error', reject);
  });
}

describe('find-pdf-extraction-worker.mjs', () => {
  it('opens documents with pdf.js evaluation of generated code turned off', async () => {
    expect(await documentOptions()).toEqual(expect.objectContaining({ isEvalSupported: false }));
  });
});
