import { NextResponse } from 'next/server';
import type { StoredFileStream } from '@/lib/storage';

// Once the headers are out, Next answers any body failure that is not an abort by logging
// it and trying to render an error page. The failure is logged here with what was being
// sent, then passed on as an abort, which only closes the connection.
function abortError(): Error {
  const error = new Error('The download was stopped');
  error.name = 'AbortError';
  return error;
}

/**
 * Passes a stored file through chunk by chunk. The file is released when the client
 * disconnects, and a file that ends short of its size counts as a failure rather than
 * a complete download.
 */
export function streamStoredFile(file: StoredFileStream, signal: AbortSignal, what: string): ReadableStream<Uint8Array> {
  const reader = file.stream.getReader();
  let sent = 0;
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    signal.removeEventListener('abort', release);
    reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', release);
  if (signal.aborted) release();

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (sent !== file.size) throw new Error(`the stored file ended after ${sent} of ${file.size} bytes`);
            released = true;
            signal.removeEventListener('abort', release);
            controller.close();
            return;
          }
          sent += value.byteLength;
          controller.enqueue(value);
        } catch (error) {
          if (!released) console.error(`Failed while sending ${what} (${sent} of ${file.size} bytes sent):`, error);
          release();
          controller.error(abortError());
        }
      },
      cancel() {
        release();
      },
    },
    { highWaterMark: 0 },
  );
}

export function storedFileResponse(
  req: Request,
  file: StoredFileStream,
  headers: Record<string, string>,
  what: string,
): NextResponse {
  return new NextResponse(streamStoredFile(file, req.signal, what), {
    headers: { ...headers, 'Content-Length': String(file.size) },
  });
}
