// Copies pdf.js's browser worker into public/pdfjs/ so the app serves it itself
// (components/dashboard/pdfjs.ts). It must be the pdfjs-dist that react-pdf resolves, not
// the top-level one the server uses: pdf.js refuses a worker of any other version. The
// version is in the file name, so the URL changes whenever react-pdf's pdfjs-dist does.
// Runs before `next dev` and `next build`:
//   node scripts/copy-pdf-worker.mjs [--out <dir>] [--resolve-from <package dir>]
// --resolve-from names the package whose pdfjs-dist is copied (react-pdf by default).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_FILE = /^pdf\.worker-.+\.min\.mjs$/;

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function reactPdfDir() {
  const requireFromApp = createRequire(path.join(ROOT, 'package.json'));
  return path.dirname(requireFromApp.resolve('react-pdf/package.json'));
}

function findWorker(resolveFrom) {
  const requireFromPackage = createRequire(path.join(resolveFrom, 'package.json'));
  let packageJsonPath;
  try {
    packageJsonPath = requireFromPackage.resolve('pdfjs-dist/package.json');
  } catch {
    throw new Error(`pdfjs-dist is not resolvable from ${resolveFrom}`);
  }
  const { version } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const source = path.join(path.dirname(packageJsonPath), 'build', 'pdf.worker.min.mjs');
  if (!fs.existsSync(source)) throw new Error(`pdfjs-dist ${version} has no worker at ${source}`);
  return { version, source };
}

function copyWorker(outDir, { version, source }) {
  const fileName = `pdf.worker-${version}.min.mjs`;
  fs.mkdirSync(outDir, { recursive: true });
  for (const existing of fs.readdirSync(outDir)) {
    if (existing !== fileName && WORKER_FILE.test(existing)) fs.rmSync(path.join(outDir, existing));
  }
  fs.copyFileSync(source, path.join(outDir, fileName));
  return fileName;
}

try {
  const outDir = path.resolve(option('--out') ?? path.join(ROOT, 'public', 'pdfjs'));
  const fileName = copyWorker(outDir, findWorker(option('--resolve-from') ?? reactPdfDir()));
  console.log(`Copied the pdf.js worker to ${path.join(outDir, fileName)}`);
} catch (error) {
  console.error(`Could not copy the pdf.js worker: ${error.message}`);
  process.exit(1);
}
