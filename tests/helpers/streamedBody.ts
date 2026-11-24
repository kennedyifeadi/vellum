import { NextRequest } from 'next/server';

export const KB = 1024;
export const MB = 1024 * KB;

export interface StreamedBody {
  request: NextRequest;
  /** How many bytes the route pulled from the body. */
  bytesRead(): number;
}

interface StreamedBodyOptions {
  method?: string;
  contentType: string;
  /** The Content-Length to send, or none for a body that arrives like a chunked one. */
  declaredLength?: number;
  chunkBytes?: number;
  headers?: Record<string, string>;
}

/**
 * A body of `sizeBytes` spaces, produced only as the route pulls it, so that a request of
 * hundreds of megabytes costs nothing unless the route reads it.
 */
export function streamedBody(
  url: string,
  sizeBytes: number,
  { method = 'POST', contentType, declaredLength, chunkBytes = 64 * KB, headers = {} }: StreamedBodyOptions,
): StreamedBody {
  const chunk = new Uint8Array(chunkBytes).fill(32);
  let pulled = 0;

  // No high-water mark, so nothing is produced before the route asks for it.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= sizeBytes) return controller.close();
      const next = chunk.subarray(0, Math.min(chunkBytes, sizeBytes - pulled));
      pulled += next.byteLength;
      controller.enqueue(next);
    },
  }, { highWaterMark: 0 });

  const allHeaders: Record<string, string> = { 'content-type': contentType, ...headers };
  if (declaredLength !== undefined) allHeaders['content-length'] = String(declaredLength);

  // Node needs `duplex` to send a streamed body; the RequestInit type does not list it.
  const init = { method, headers: allHeaders, body, duplex: 'half' };
  const request = new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]);
  return { request, bytesRead: () => pulled };
}

/** `text` followed by spaces up to exactly `sizeBytes` bytes. */
export function paddedTo(text: string, sizeBytes: number): string {
  return text + ' '.repeat(sizeBytes - Buffer.byteLength(text));
}
