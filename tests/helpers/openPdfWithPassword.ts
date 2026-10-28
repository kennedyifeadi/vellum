import { execFile } from 'child_process';

// pdf.js opens the file as Firefox's viewer would, sharing no crypto with the code that
// locked it. Jest cannot import pdf.js into a test, so it runs in its own Node process.
// The password travels on stdin rather than argv so non-ASCII text arrives unchanged.
const OPEN_WITH_PASSWORD = `
  import { buffer } from 'stream/consumers';
  import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

  console.log = () => {};
  console.warn = () => {};
  const print = (result) => process.stdout.write(JSON.stringify(result));

  const { pdf, password } = JSON.parse((await buffer(process.stdin)).toString('utf8'));
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(pdf, 'base64')), password, isEvalSupported: false }).promise;
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const { items } = await (await doc.getPage(pageNumber)).getTextContent();
      pageTexts.push(items.map((item) => item.str ?? '').join(''));
    }
    print({ pageTexts });
  } catch (error) {
    print({ error: error.name });
  }
`;

export type PdfjsOpenResult = { pageTexts: string[] } | { error: string };

export function openPdfWithPassword(pdf: Buffer, password: string): Promise<PdfjsOpenResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', OPEN_WITH_PASSWORD],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout))),
    );
    child.stdin!.end(JSON.stringify({ pdf: pdf.toString('base64'), password }));
  });
}
