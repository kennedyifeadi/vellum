import { PDFDocument } from 'pdf-lib';
import { ClientError } from '@/lib/convert/errors';

interface LoadPdfOptions {
  /**
   * Prefixes the empty/corrupt messages, e.g. `File 2`. Multi-file callers use this so
   * the user can tell which input is at fault. Defaults to `The PDF file`.
   */
  label?: string;
  /** Overrides the generic encryption message with tool-specific wording. */
  encryptedMessage?: string;
}

/**
 * Loads a PDF, turning the three caller-fault cases pdf-lib would otherwise surface as
 * an opaque crash into a `ClientError`: empty input, an unparseable/corrupt file, and
 * an encrypted document (`ignoreEncryption` skips the load-time guard but never
 * decrypts, so any later page-tree walk fails deep inside pdf-lib).
 */
export async function loadPdf(pdfBuffer: Buffer, options: LoadPdfOptions = {}): Promise<PDFDocument> {
  const subject = options.label ?? 'The PDF file';

  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new ClientError(`${subject} is empty.`);
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  } catch (error) {
    throw new ClientError(`${subject} is not a valid PDF or is corrupted.`, 400, { cause: error });
  }

  if (pdfDoc.isEncrypted) {
    throw new ClientError(
      options.encryptedMessage ??
        `${subject} is password-protected. Please remove the password before continuing.`,
    );
  }

  return pdfDoc;
}
