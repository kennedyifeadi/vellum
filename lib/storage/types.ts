/**
 * A stored file opened for reading. Whoever opens it must read the stream to the end or
 * cancel it, which releases the file handle or connection behind it.
 */
export interface StoredFileStream {
  stream: ReadableStream<Uint8Array>;
  size: number;
}

/**
 * Storage driver contract. `key` is a path-like identifier relative to the
 * storage root (e.g. "docs/<uuid>.pdf" or "<uuid>.pdf") — drivers translate
 * it into whatever addressing scheme they use (a local file path, an S3
 * object key, etc).
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  openRead(key: string): Promise<StoredFileStream | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
