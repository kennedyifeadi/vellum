import { LocalDiskStorage } from './local';
import { S3Storage } from './s3';
import type { StorageDriver } from './types';

export type { StorageDriver } from './types';
export { LocalDiskStorage } from './local';
export { S3Storage } from './s3';

const DRIVERS = ['s3', 'local'] as const;
type DriverName = (typeof DRIVERS)[number];

let cachedStorage: StorageDriver | null = null;

/**
 * Development and tests default to local disk. Production has to name a driver, so files
 * never land by accident on a disk that the next redeploy wipes.
 */
function configuredDriver(): DriverName {
  const value = process.env.STORAGE_DRIVER;

  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No storage driver is configured. Set STORAGE_DRIVER=s3 with the S3_* variables for the R2 bucket ' +
          "(or STORAGE_DRIVER=local to keep files on this server's disk, which a redeploy deletes)."
      );
    }
    return 'local';
  }

  if (!(DRIVERS as readonly string[]).includes(value)) {
    throw new Error(`STORAGE_DRIVER is "${value}", but it must be one of: ${DRIVERS.join(', ')}.`);
  }
  return value as DriverName;
}

export function getStorage(): StorageDriver {
  if (cachedStorage) return cachedStorage;

  if (configuredDriver() === 's3') {
    cachedStorage = new S3Storage();
    return cachedStorage;
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn(
      "STORAGE_DRIVER=local in production: files are kept on this server's disk and are lost on every redeploy."
    );
  }
  cachedStorage = new LocalDiskStorage();
  return cachedStorage;
}
