import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { promisify } from 'util';

const run = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'copy-pdf-worker.mjs');

jest.setTimeout(60_000);

function reactPdfPdfjsDist() {
  const requireFromApp = createRequire(path.join(ROOT, 'package.json'));
  const requireFromReactPdf = createRequire(requireFromApp.resolve('react-pdf/package.json'));
  const packageJsonPath = requireFromReactPdf.resolve('pdfjs-dist/package.json');
  const { version } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string };
  return { version, worker: path.join(path.dirname(packageJsonPath), 'build', 'pdf.worker.min.mjs') };
}

function copyWorker(...args: string[]) {
  return run(process.execPath, [SCRIPT, ...args], { cwd: ROOT });
}

async function copyFailure(...args: string[]) {
  try {
    await copyWorker(...args);
  } catch (error) {
    return error as { code: number; stderr: string };
  }
  throw new Error('the copy succeeded');
}

describe('scripts/copy-pdf-worker.mjs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-worker-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("copies the worker of react-pdf's own pdfjs-dist, named by its version", async () => {
    const { version, worker } = reactPdfPdfjsDist();
    const outDir = path.join(tempDir, 'pdfjs');

    await copyWorker('--out', outDir);

    expect(fs.readdirSync(outDir)).toEqual([`pdf.worker-${version}.min.mjs`]);
    expect(fs.readFileSync(path.join(outDir, `pdf.worker-${version}.min.mjs`)).equals(fs.readFileSync(worker))).toBe(true);
  });

  it('removes copies of other versions and leaves other files alone', async () => {
    const { version } = reactPdfPdfjsDist();
    fs.writeFileSync(path.join(tempDir, 'pdf.worker-1.0.0.min.mjs'), 'old');
    fs.writeFileSync(path.join(tempDir, `pdf.worker-${version}.min.mjs`), 'stale bytes');
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'keep');

    await copyWorker('--out', tempDir);

    expect(fs.readdirSync(tempDir).sort()).toEqual(['notes.txt', `pdf.worker-${version}.min.mjs`]);
    expect(fs.readFileSync(path.join(tempDir, `pdf.worker-${version}.min.mjs`), 'utf8')).not.toBe('stale bytes');
  });

  it('fails clearly when pdfjs-dist cannot be resolved', async () => {
    const lonePackage = path.join(tempDir, 'lone-package');
    fs.mkdirSync(lonePackage);
    fs.writeFileSync(path.join(lonePackage, 'package.json'), '{"name":"lone-package"}');

    const failure = await copyFailure('--out', path.join(tempDir, 'out'), '--resolve-from', lonePackage);

    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain(`Could not copy the pdf.js worker: pdfjs-dist is not resolvable from ${lonePackage}`);
    expect(fs.existsSync(path.join(tempDir, 'out'))).toBe(false);
  });

  it('fails clearly when pdfjs-dist has no worker build', async () => {
    const consumer = path.join(tempDir, 'consumer');
    const pdfjsDist = path.join(consumer, 'node_modules', 'pdfjs-dist');
    fs.mkdirSync(pdfjsDist, { recursive: true });
    fs.writeFileSync(path.join(consumer, 'package.json'), '{"name":"consumer"}');
    fs.writeFileSync(path.join(pdfjsDist, 'package.json'), '{"name":"pdfjs-dist","version":"9.9.9"}');

    const failure = await copyFailure('--out', path.join(tempDir, 'out'), '--resolve-from', consumer);

    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain('Could not copy the pdf.js worker: pdfjs-dist 9.9.9 has no worker at');
    expect(fs.existsSync(path.join(tempDir, 'out'))).toBe(false);
  });
});
