import { execFile } from 'child_process';

// pdf.js opens the file as Firefox's viewer would, sharing no crypto with the code that
// locked it. Jest cannot import pdf.js into a test, so it runs in its own Node process,
// one per file: loading pdf.js dominates the cost, so every password is tried there.
// The passwords travel on stdin rather than argv so non-ASCII text arrives unchanged.
const OPEN_WITH_PASSWORDS = `
  import { buffer } from 'stream/consumers';
  import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

  console.log = () => {};
  console.warn = () => {};

  const { pdf, passwords } = JSON.parse((await buffer(process.stdin)).toString('utf8'));
  const results = [];
  for (const password of passwords) {
    try {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(pdf, 'base64')), password, isEvalSupported: false }).promise;
      const pageTexts = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const { items } = await (await doc.getPage(pageNumber)).getTextContent();
        pageTexts.push(items.map((item) => item.str ?? '').join(''));
      }
      await doc.destroy();
      results.push({ pageTexts });
    } catch (error) {
      results.push({ error: error.name });
    }
  }
  process.stdout.write(JSON.stringify(results));
`;

export type PdfjsOpenResult = { pageTexts: string[] } | { error: string };

/** What pdf.js makes of `pdf` with each password in turn. */
export function openPdfWithPasswords(pdf: Buffer, passwords: string[]): Promise<PdfjsOpenResult[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', OPEN_WITH_PASSWORDS],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))),
    );
    child.stdin!.end(JSON.stringify({ pdf: pdf.toString('base64'), passwords }));
  });
}
