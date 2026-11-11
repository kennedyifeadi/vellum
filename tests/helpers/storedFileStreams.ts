import type { StoredFileStream } from '@/lib/storage';

export interface TrackedFile extends StoredFileStream {
  cancelled: Promise<void>;
  wasCancelled(): boolean;
}

/**
 * A stored file served a few bytes per read, which records whether its reader cancelled
 * it and can fail part way like a dropped storage connection.
 */
export function trackedFile(bytes: Buffer, { chunkSize = 4, failAfterChunks }: { chunkSize?: number; failAfterChunks?: number } = {}): TrackedFile {
  let markCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => (markCancelled = resolve));
  let isCancelled = false;
  let offset = 0;
  let chunks = 0;

  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (failAfterChunks !== undefined && chunks === failAfterChunks) {
          controller.error(new Error('storage connection reset'));
          return;
        }
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + chunkSize)));
        offset += chunkSize;
        chunks += 1;
      },
      cancel() {
        isCancelled = true;
        markCancelled();
      },
    },
    { highWaterMark: 0 },
  );

  return { stream, size: bytes.length, cancelled, wasCancelled: () => isCancelled };
}
