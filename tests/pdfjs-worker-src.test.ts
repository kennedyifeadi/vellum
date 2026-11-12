import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { promisify } from 'util';

const ROOT = path.resolve(__dirname, '..');

function reactPdfPdfjsVersion(): string {
  const requireFromApp = createRequire(path.join(ROOT, 'package.json'));
  const requireFromReactPdf = createRequire(requireFromApp.resolve('react-pdf/package.json'));
  return (JSON.parse(fs.readFileSync(requireFromReactPdf.resolve('pdfjs-dist/package.json'), 'utf8')) as { version: string }).version;
}

const mockVersion = reactPdfPdfjsVersion();
const mockWorkerOptions: { workerSrc?: string } = {};
// pdf.js needs browser APIs jsdom and Node lack, so react-pdf's pdfjs is stood in for with
// the version react-pdf really ships.
jest.mock('react-pdf', () => ({
  pdfjs: { version: mockVersion, GlobalWorkerOptions: mockWorkerOptions },
}));

import '../components/dashboard/pdfjs';

jest.setTimeout(60_000);

describe('pdf.js worker source', () => {
  it('is served by the app itself, never another origin', () => {
    const appOrigin = 'https://vellum.example';

    expect(new URL(mockWorkerOptions.workerSrc!, `${appOrigin}/dashboard`).origin).toBe(appOrigin);
  });

  it("names react-pdf's pdf.js version", () => {
    expect(mockWorkerOptions.workerSrc).toContain(mockVersion);
  });

  it('is the file the copy script writes to public/', async () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-'));
    try {
      const script = path.join(ROOT, 'scripts', 'copy-pdf-worker.mjs');
      await promisify(execFile)(process.execPath, [script, '--out', path.join(publicDir, 'pdfjs')], { cwd: ROOT });

      expect(fs.existsSync(path.join(publicDir, ...mockWorkerOptions.workerSrc!.split('/')))).toBe(true);
    } finally {
      fs.rmSync(publicDir, { recursive: true, force: true });
    }
  });
});
