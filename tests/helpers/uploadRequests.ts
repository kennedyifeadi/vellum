import { NextRequest } from 'next/server';

const BOUNDARY = '----vellum-test-boundary';
const CHUNK = new Uint8Array(1024 * 1024);

export const MB = 1024 * 1024;

export interface StreamedUpload {
  request: NextRequest;
  /** How many bytes the route pulled from the body. */
  bytesRead(): number;
}

/**
 * A multipart upload of one `sizeBytes` file under `field`, produced lazily so that a
 * request of hundreds of megabytes costs nothing unless the route reads it. With
 * `declareLength` it carries a Content-Length, otherwise it arrives like a chunked body.
 */
export function streamedUpload(
  url: string,
  field: string,
  sizeBytes: number,
  { declareLength = true, fileName = 'upload.bin' } = {},
): StreamedUpload {
  const head = new TextEncoder().encode(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${BOUNDARY}--\r\n`);

  let pulled = 0;
  let fileBytesLeft = sizeBytes;
  let stage: 'head' | 'file' | 'tail' | 'done' = 'head';

  // No high-water mark, so nothing is produced before the route asks for it.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      let chunk: Uint8Array;
      if (stage === 'head') {
        chunk = head;
        stage = 'file';
      } else if (stage === 'file' && fileBytesLeft > 0) {
        chunk = CHUNK.subarray(0, Math.min(CHUNK.length, fileBytesLeft));
        fileBytesLeft -= chunk.length;
      } else if (stage !== 'done') {
        chunk = tail;
        stage = 'done';
      } else {
        controller.close();
        return;
      }
      pulled += chunk.length;
      controller.enqueue(chunk);
    },
  }, { highWaterMark: 0 });

  const headers: Record<string, string> = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };
  if (declareLength) {
    headers['content-length'] = String(head.length + sizeBytes + tail.length);
  }

  // Node needs `duplex` to send a streamed body; the RequestInit type does not list it.
  const init = { method: 'POST', headers, body, duplex: 'half' };
  const request = new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]);
  return { request, bytesRead: () => pulled };
}

/** A request to `url` with a raw body and content type, for malformed uploads. */
export function rawRequest(url: string, body: BodyInit | null, contentType?: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: contentType ? { 'content-type': contentType } : {},
    body,
  });
}

/** A multipart request built from `entries`, each either text or a named file. */
export function formRequest(url: string, entries: [string, string | { bytes: Uint8Array | string; name: string; type?: string }][]): NextRequest {
  const form = new FormData();
  for (const [name, value] of entries) {
    if (typeof value === 'string') {
      form.append(name, value);
    } else {
      form.append(name, new File([value.bytes as BlobPart], value.name, { type: value.type ?? 'application/octet-stream' }));
    }
  }
  return new NextRequest(url, { method: 'POST', body: form });
}

export const MULTIPART_CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;
