import { PDFDocument } from 'pdf-lib';
import { ClientError } from '@/lib/convert/errors';
import { loadPdf } from './loadPdf';

interface SplitPdfOptions {
  pdfBuffer: Buffer;
  startPage?: number;
  endPage?: number;
  splitEvery?: boolean;
  outputFileNamePrefix: string;
}

export async function splitPdf({
  pdfBuffer,
  startPage = 1,
  endPage = 1,
  splitEvery = false,
  outputFileNamePrefix,
}: SplitPdfOptions): Promise<Map<string, Buffer>> {
  const originalPdf = await loadPdf(pdfBuffer, {
    encryptedMessage:
      'This PDF is password-protected. Please remove the password before splitting it.',
  });

  const totalPages = originalPdf.getPageCount();
  const splitPdfs = new Map<string, Buffer>();

  if (!splitEvery) {
    const requestedStart = Math.min(startPage, endPage);
    const requestedEnd = Math.max(startPage, endPage);

    if (requestedStart > totalPages) {
      throw new ClientError(
        `Page range ${requestedStart}-${requestedEnd} is outside this ${totalPages}-page document.`,
      );
    }

    const newPdf = await PDFDocument.create();
    const minPage = Math.max(0, requestedStart - 1);
    const maxPage = Math.min(totalPages - 1, requestedEnd - 1);

    const indicesToCopy = Array.from({ length: maxPage - minPage + 1 }, (_, i) => minPage + i);

    const copiedPages = await newPdf.copyPages(originalPdf, indicesToCopy);
    copiedPages.forEach((page) => newPdf.addPage(page));

    splitPdfs.set(`${outputFileNamePrefix}_pages_${minPage + 1}_to_${maxPage + 1}.pdf`, Buffer.from(await newPdf.save()));
  } else {
    for (let i = 0; i < totalPages; i++) {
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(originalPdf, [i]);
      newPdf.addPage(copiedPage);
      splitPdfs.set(`${outputFileNamePrefix}_page_${i + 1}.pdf`, Buffer.from(await newPdf.save()));
    }
  }

  return splitPdfs;
}
