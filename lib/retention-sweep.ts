import dbConnect from '@/lib/db/mongoose';
import { ensurePlainExpiryIndex } from '@/lib/db/expiry-index';
import { reasonOf } from '@/lib/reason-of';
import { getStorage } from '@/lib/storage';
import { deleteExpiredFiles, STORED_FILE_KINDS, type StoredFileKind } from '@/lib/stored-files';

// Deletes what has expired, on every storage driver. It imports nothing from Next.

// Issue #158 allows at most 15 minutes between sweeps; 10 leaves room for a slow one.
export const RETENTION_SWEEP_MS = 10 * 60 * 1000;

// On globalThis, because instrumentation.ts can be loaded again in development.
const globalForRetention = globalThis as typeof globalThis & { vellumRetentionSweep?: NodeJS.Timeout };

async function sweepKind(kind: StoredFileKind): Promise<void> {
  try {
    await ensurePlainExpiryIndex(kind.model);
  } catch (error) {
    // The sweep still runs: while the TTL index is left, each file deleted before MongoDB
    // drops its row is one fewer orphaned. The next sweep tries the index again.
    console.error('Could not replace a TTL index on expiresAt:', error);
  }
  await deleteExpiredFiles(kind);
}

/** One sweep. A failure with one kind of file doesn't stop the other's. */
export async function sweepExpiredFiles(): Promise<void> {
  try {
    await dbConnect();
  } catch (error) {
    console.error('Retention sweep could not reach the database:', error);
    return;
  }
  for (const kind of STORED_FILE_KINDS) {
    try {
      await sweepKind(kind);
    } catch (error) {
      console.error('Retention sweep failed:', error);
    }
  }
}

/**
 * Starts this process's sweep, once: one now and then one every RETENTION_SWEEP_MS. It runs
 * during server startup, so it never throws: without a database or storage it logs why
 * expired files will not be deleted.
 */
export function startRetentionSweep(): void {
  if (globalForRetention.vellumRetentionSweep) return;
  if (!process.env.MONGODB_URI) {
    console.warn('Expired files will not be deleted: MONGODB_URI is not set.');
    return;
  }
  try {
    getStorage();
  } catch (error) {
    console.error(`Expired files will not be deleted: ${reasonOf(error)}`);
    return;
  }

  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    await sweepExpiredFiles();
    sweeping = false;
  };
  globalForRetention.vellumRetentionSweep = setInterval(() => void sweep(), RETENTION_SWEEP_MS).unref();
  void sweep();
}
