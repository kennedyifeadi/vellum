import { ClientError } from '@/lib/convert/errors';

// Room for the multipart framing around the files and for the form's text fields: a
// part's boundary and headers take a few hundred bytes (under 1 KB with a 255-character
// name), so this covers the largest file count any plan allows (250) several times over.
// It is the most a refused request can exceed the route's cap by before it is cut off.
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** How much file data a route accepts in one request, and how it refuses more. */
export interface UploadBudget {
  maxBytes: number;
  /**
   * The route's own over-cap error. `bytes` is the size of the file that was over the cap
   * when it is known; it is omitted when only the request was measured, since a request's
   * size is not its file's.
   */
  tooLarge(bytes?: number): ClientError;
}

/** A budget whose refusal is one fixed message, for a route with a single size cap. */
export function uploadBudget(maxBytes: number, tooLargeMessage: string, status = 400): UploadBudget {
  return { maxBytes, tooLarge: () => new ClientError(tooLargeMessage, status) };
}

export const NOT_MULTIPART_MESSAGE = 'Please upload the file as multipart/form-data.';
export const UNREADABLE_UPLOAD_MESSAGE = 'The upload could not be read. Please try again.';

function isMultipart(req: Request): boolean {
  return /^multipart\/form-data\s*;/i.test(req.headers.get('content-type') ?? '');
}

function declaredLength(req: Request): number | null {
  const header = req.headers.get('content-length');
  return header !== null && /^\d+$/.test(header) ? Number(header) : null;
}

async function readCountedBody(req: Request, maxRequestBytes: number, budget: UploadBudget): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  if (!req.body) return new Blob();

  const reader = req.body.getReader();
  let received = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      throw new ClientError(UNREADABLE_UPLOAD_MESSAGE, 400, { cause: error });
    }
    if (chunk.done) break;

    received += chunk.value.byteLength;
    if (received > maxRequestBytes) {
      await reader.cancel().catch(() => undefined);
      throw budget.tooLarge();
    }
    chunks.push(chunk.value);
  }
  return new Blob(chunks as BlobPart[]);
}

/**
 * Reads a multipart upload within `budget`, for a route that has already resolved the
 * caller's plan. A request whose Content-Length is over the budget is refused before any
 * of its body is read; one without a Content-Length is counted as it is read and cut off
 * once it passes the budget. Anything that is not a readable multipart form is a 400.
 */
export async function readMultipartForm(req: Request, budget: UploadBudget): Promise<FormData> {
  if (!isMultipart(req)) {
    throw new ClientError(NOT_MULTIPART_MESSAGE);
  }

  const maxRequestBytes = budget.maxBytes + MULTIPART_OVERHEAD_BYTES;
  const length = declaredLength(req);
  if (length !== null && length > maxRequestBytes) {
    throw budget.tooLarge();
  }

  const body = await readCountedBody(req, maxRequestBytes, budget);
  try {
    return await new Response(body, { headers: { 'content-type': req.headers.get('content-type')! } }).formData();
  } catch (error) {
    throw new ClientError(UNREADABLE_UPLOAD_MESSAGE, 400, { cause: error });
  }
}

/**
 * A text field of the form, or null when it is absent. A file sent where text is
 * expected is the caller's mistake.
 */
export function textField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (value !== null && typeof value !== 'string') {
    throw new ClientError(`The "${name}" field must be text, not a file.`);
  }
  return value;
}
