import User from '@/models/user';
import { forgetSessions } from '@/lib/auth/session';
import { getStorage, type StorageDriver } from '@/lib/storage';
import { deleteExpiredFiles, expireFilesOf, STORED_FILE_KINDS } from '@/lib/stored-files';
import { deleteVideoJobsOf, discardVideoJobsOf } from '@/lib/video/video-job-service';

export interface DeletedAccount {
  /** Some files could not be deleted yet. Their rows are expired, so the sweeps retry them. */
  filesPending: boolean;
}

async function expireEverything(userId: string): Promise<void> {
  for (const kind of STORED_FILE_KINDS) await expireFilesOf(kind, userId);
  await discardVideoJobsOf(userId);
}

async function deleteEverything(userId: string, storage: StorageDriver): Promise<boolean> {
  let allDeleted = true;
  for (const kind of STORED_FILE_KINDS) {
    allDeleted = (await deleteExpiredFiles(kind, { userId })) && allDeleted;
  }
  return (await deleteVideoJobsOf(userId, storage)) && allDeleted;
}

/**
 * Deletes the account with its conversions, documents and video jobs. Everything is expired
 * before the account goes, so a failure from then on leaves only records the sweeps retry,
 * and again afterwards for what was written meanwhile. A write later than that finds no
 * account and removes itself.
 */
export async function deleteAccount(userId: string): Promise<DeletedAccount> {
  // Resolved first, so without storage nothing is changed.
  const storage = getStorage();
  await expireEverything(userId);
  await User.findByIdAndDelete(userId);
  forgetSessions(userId);

  try {
    await expireEverything(userId);
    return { filesPending: !(await deleteEverything(userId, storage)) };
  } catch (error) {
    console.error(`Account ${userId} is deleted, but deleting its files has to be retried:`, error);
    return { filesPending: true };
  }
}
