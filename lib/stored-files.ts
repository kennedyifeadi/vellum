import Conversion from '@/models/conversion';
import UserDocumentModel from '@/models/userDocument';
import { accountExists } from '@/lib/account';
import { getStorage } from '@/lib/storage';

// A user's stored files are each recorded by a row with an expiresAt, and a row is deleted
// only after its file, so no key is forgotten while the file may still be stored (#158).

/** One kind of stored file: the model of its rows and the storage folder of its keys. */
export interface StoredFileKind {
  folder: string;
  model: typeof Conversion;
}

export const CONVERSION_FILES: StoredFileKind = { folder: '', model: Conversion };
export const DOCUMENT_FILES: StoredFileKind = { folder: 'docs', model: UserDocumentModel };
export const STORED_FILE_KINDS = [CONVERSION_FILES, DOCUMENT_FILES];

const DELETE_BATCH_SIZE = 50;

interface StoredRow {
  _id: unknown;
  /** Absent on a history row, which has no file. */
  diskFileName?: string;
}

interface NewStoredRow extends Record<string, unknown> {
  userId: string;
  expiresAt: Date;
  diskFileName?: string;
}

/** Matches the rows their owner may still see: from expiresAt on, a row is gone to them. */
export function unexpired() {
  return { expiresAt: { $gt: new Date() } };
}

function storageKey({ folder }: StoredFileKind, diskFileName: string): string {
  return folder ? `${folder}/${diskFileName}` : diskFileName;
}

async function deleteFileThenRow(kind: StoredFileKind, row: StoredRow): Promise<boolean> {
  const key = row.diskFileName && storageKey(kind, row.diskFileName);
  try {
    if (key) await getStorage().delete(key);
    await kind.model.deleteOne({ _id: row._id });
    return true;
  } catch (error) {
    console.error(`Failed to delete ${key || `history row ${row._id}`}, so it will be retried:`, error);
    return false;
  }
}

async function removeUnrecordedFile(kind: StoredFileKind, row: NewStoredRow): Promise<void> {
  if (!row.diskFileName) return;
  const key = storageKey(kind, row.diskFileName);
  try {
    await getStorage().delete(key);
  } catch (error) {
    console.error(`Failed to delete ${key}, which no row records:`, error);
    try {
      await kind.model.create({ ...row, expiresAt: new Date() });
    } catch (recordError) {
      console.error(`Could not record the undeleted ${key} either:`, recordError);
    }
  }
}

/**
 * Creates the row of a file just stored, or of history. If it can't, the file is removed.
 * Null when the account is gone: what was written is removed again. The account is checked
 * after the create, so a deletion either sees this row or is seen by this check.
 */
export async function recordForAccount(kind: StoredFileKind, row: NewStoredRow) {
  let record;
  try {
    record = await kind.model.create(row);
  } catch (error) {
    await removeUnrecordedFile(kind, row);
    throw error;
  }
  if (await accountExists(row.userId)) return record;

  await removeStoredFile(kind, record);
  return null;
}

/** Expires all of a user's rows of one kind, which hands their files to the sweep. */
export async function expireFilesOf(kind: StoredFileKind, userId: string): Promise<void> {
  await kind.model.updateMany({ userId }, { $set: { expiresAt: new Date() } });
}

/**
 * Deletes one row's file and then the row. The row is expired first, so it is gone to its
 * owner even when the file can't be deleted yet; the sweep then retries, and this is false.
 */
export async function removeStoredFile(kind: StoredFileKind, row: StoredRow): Promise<boolean> {
  await kind.model.updateOne({ _id: row._id }, { $set: { expiresAt: new Date() } });
  return deleteFileThenRow(kind, row);
}

/**
 * Deletes the expired files and then their rows, in batches. A failed delete keeps its row
 * for the next try, and the answer is then false. Safe to run in two processes at once.
 */
export async function deleteExpiredFiles(kind: StoredFileKind, owner: { userId?: string } = {}): Promise<boolean> {
  const expired = { ...owner, expiresAt: { $lte: new Date() } };
  let allDeleted = true;
  let after = {};

  for (;;) {
    // Paged by _id, so rows whose delete keeps failing don't hold up the ones after them.
    const batch: StoredRow[] = await kind.model
      .find({ ...expired, ...after }, 'diskFileName')
      .sort({ _id: 1 })
      .limit(DELETE_BATCH_SIZE)
      .lean();
    const deleted = await Promise.all(batch.map((row) => deleteFileThenRow(kind, row)));
    allDeleted &&= deleted.every(Boolean);

    if (batch.length < DELETE_BATCH_SIZE) return allDeleted;
    after = { _id: { $gt: batch[batch.length - 1]._id } };
  }
}
