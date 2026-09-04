import { LocalDiskStorage } from './local';
import { S3Storage } from './s3';
import type { StorageDriver } from './types';

export type { StorageDriver } from './types';
export { LocalDiskStorage } from './local';
export { S3Storage } from './s3';

let cachedStorage: StorageDriver | null = null;

/**
 * Returns the configured storage driver. Defaults to local disk so existing
 * deployments keep working unchanged until STORAGE_DRIVER=s3 is set.
 */
export function getStorage(): StorageDriver {
  if (cachedStorage) return cachedStorage;

  const driver = process.env.STORAGE_DRIVER ?? 'local';
  cachedStorage = driver === 's3' ? new S3Storage() : new LocalDiskStorage();
  return cachedStorage;
}
