import { execFile } from 'child_process';

// pdf.js draws each page as a viewer would, independently of pdf-lib, which wrote the
// PDF. Jest cannot import pdf.js into a test, so it runs in its own Node process.
// pdf.js must create the canvas itself: one from a second copy of the canvas addon
// crashes the process.
const RENDER_PAGES = `
  import { buffer } from 'stream/consumers';
  import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

  console.log = () => {};
  console.warn = () => {};

  const scale = Number(process.argv[1]);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await buffer(process.stdin)), isEvalSupported: false }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const { canvas, context } = pdf.canvasFactory.create(Math.round(viewport.width), Math.round(viewport.height));
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    pages.push({ width, height, rgba: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64') });
  }
  process.stdout.write(JSON.stringify(pages));
`;

export interface RenderedPage {
  /** In pixels: the page's size in points times the scale. */
  width: number;
  height: number;
  rgba: Buffer;
  /** The colour at (x, y), measured from the top left. */
  colourAt(x: number, y: number): [number, number, number];
}

function renderedPage({ width, height, rgba }: { width: number; height: number; rgba: string }): RenderedPage {
  const pixels = Buffer.from(rgba, 'base64');
  return {
    width,
    height,
    rgba: pixels,
    colourAt(x, y) {
      const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
      return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
    },
  };
}

/** Every page of `pdf` as pdf.js draws it, at `scale` pixels per point. */
export function renderPdfPages(pdf: Buffer, scale = 1): Promise<RenderedPage[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', RENDER_PAGES, String(scale)],
      { maxBuffer: 512 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout).map(renderedPage))),
    );
    child.stdin!.end(pdf);
  });
}
