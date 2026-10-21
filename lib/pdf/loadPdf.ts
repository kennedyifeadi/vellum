import { PDFDocument } from 'pdf-lib';
import { ClientError } from '@/lib/convert/errors';

const DEFAULT_SUBJECT = 'The PDF file';

export function emptyPdfMessage(subject = DEFAULT_SUBJECT): string {
  return `${subject} is empty.`;
}

export function corruptPdfMessage(subject = DEFAULT_SUBJECT): string {
  return `${subject} is not a valid PDF or is corrupted.`;
}

export function encryptedPdfMessage(subject = DEFAULT_SUBJECT): string {
  return `${subject} is password-protected. Please remove the password before continuing.`;
}

interface LoadPdfOptions {
  /**
   * Prefixes the empty/corrupt messages, e.g. `File 2`. Multi-file callers use this so
   * the user can tell which input is at fault. Defaults to `The PDF file`.
   */
  label?: string;
  /** Overrides the generic encryption message with tool-specific wording. */
  encryptedMessage?: string;
  /**
   * Forwarded to `PDFDocument.load`. Pass `false` when the caller strips document dates
   * itself and does not want pdf-lib stamping a fresh Producer / ModDate on load.
   */
  updateMetadata?: boolean;
}

/**
 * Loads a PDF, turning the three caller-fault cases pdf-lib would otherwise surface as
 * an opaque crash into a `ClientError`: empty input, an unparseable/corrupt file, and
 * an encrypted document (`ignoreEncryption` skips the load-time guard but never
 * decrypts, so any later page-tree walk fails deep inside pdf-lib).
 */
export async function loadPdf(pdfBuffer: Buffer, options: LoadPdfOptions = {}): Promise<PDFDocument> {
  const subject = options.label ?? DEFAULT_SUBJECT;

  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new ClientError(emptyPdfMessage(subject));
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBuffer, {
      ignoreEncryption: true,
      updateMetadata: options.updateMetadata,
    });
  } catch (error) {
    throw new ClientError(corruptPdfMessage(subject), 400, { cause: error });
  }

  if (pdfDoc.isEncrypted) {
    throw new ClientError(options.encryptedMessage ?? encryptedPdfMessage(subject));
  }

  // pdf-lib loads a file with no document catalog (a bare `%PDF` header) without
  // complaint; it only fails once the page tree is walked.
  try {
    pdfDoc.getPageCount();
  } catch (error) {
    throw new ClientError(corruptPdfMessage(subject), 400, { cause: error });
  }

  return pdfDoc;
}
