import { pdfjs } from 'react-pdf';

// Copied into public/ by scripts/copy-pdf-worker.mjs. pdf.js refuses a worker of another
// version, so the file is named by the version react-pdf's own pdfjs-dist reports.
pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker-${pdfjs.version}.min.mjs`;

export async function countPdfPages(file: Blob): Promise<number> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    return (await loadingTask.promise).numPages;
  } finally {
    await loadingTask.destroy();
  }
}
