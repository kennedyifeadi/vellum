import { execFile } from 'child_process';
import type { PdfTextItem } from '@/lib/convert/find-pdf-extraction';

// What the find-pdf route did before extraction moved to a worker: pdf.js on a main
// thread, with its canvas addon loaded. Jest cannot import pdf.js into a test, and the
// point is a reference that shares nothing with the worker, so it runs in its own Node
// process.
const EXTRACT_ON_MAIN_THREAD = `
  import { buffer } from 'stream/consumers';
  import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

  const print = (result) => process.stdout.write(JSON.stringify(result));
  console.log = () => {};
  console.warn = () => {};

  try {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await buffer(process.stdin)), useSystemFonts: true }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const { items } = await page.getTextContent();
      pages.push(
        items
          .filter((item) => typeof item.str === 'string')
          .map(({ str, hasEOL, width, height, transform }) => ({ str, hasEOL, width, height, transform })),
      );
    }
    print({ pages });
  } catch (error) {
    print({ parserError: error.name });
  }
`;

export type InProcessExtraction = { pages: PdfTextItem[][] } | { parserError: string };

export function extractTextItemsInProcess(pdf: Buffer): Promise<InProcessExtraction> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', EXTRACT_ON_MAIN_THREAD],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))),
    );
    child.stdin!.end(pdf);
  });
}
