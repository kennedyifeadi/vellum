import { pdfjs } from 'react-pdf';

// Set up the worker for pdf.js using a stable CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export async function countPdfPages(file: Blob): Promise<number> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    return (await loadingTask.promise).numPages;
  } finally {
    await loadingTask.destroy();
  }
}
