import crypto from 'crypto';
import path from 'path';
import Conversion from '@/models/conversion';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { getStorage, LocalDiskStorage } from '@/lib/storage';
import { retentionExpiry } from '@/lib/storage-limits';
import { STORED_FILE_KINDS } from '@/lib/stored-files';

const STORED_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
};

export const STORED_EXTENSIONS = Object.keys(STORED_CONTENT_TYPES);

function storedExtension(fileName: string): string | null {
  const extension = path.extname(fileName).toLowerCase();
  return extension in STORED_CONTENT_TYPES ? extension : null;
}

export function storedContentType(fileName: string): string | null {
  const extension = storedExtension(fileName);
  return extension ? STORED_CONTENT_TYPES[extension] : null;
}

interface Retention {
  expiresAt: Date;
  autoDelete: boolean;
}

/**
 * Resolves how long a user's history row is kept, or null when the user no longer exists.
 */
async function resolveRetention(userId: string): Promise<Retention | null> {
  await dbConnect();

  const user = await User.findById(userId);
  if (!user) {
    console.warn(`User ${userId} not found, skipping conversion record saving.`);
    return null;
  }

  const autoDelete = user.preferences?.autoDelete === true;
  return {
    autoDelete,
    expiresAt: autoDelete ? new Date(Date.now() + 1000) : retentionExpiry(user.plan),
  };
}

function createHistoryRow(
  userId: string,
  toolUsed: string,
  fileName: string,
  fileSize: number,
  expiresAt: Date,
  metadata?: Record<string, unknown>
) {
  return Conversion.create({
    userId,
    toolUsed,
    fileName,
    fileSize,
    status: 'Completed',
    metadata,
    expiresAt,
  });
}

/**
 * Saves a generated file buffer to storage and logs it to the database for Recent Activity.
 * `outputFileName` is the name the file is re-downloaded under; its extension decides the stored type.
 * A user with the autoDelete preference gets the history row only: the file is never stored.
 */
export async function saveConversionRecord(
  userId: string,
  toolUsed: string,
  outputFileName: string,
  fileBuffer: Buffer,
  metadata?: Record<string, unknown>
) {
  const extension = storedExtension(outputFileName);
  if (!extension) {
    throw new Error(`Cannot store "${outputFileName}": unsupported output type.`);
  }

  const retention = await resolveRetention(userId);
  if (!retention) return null;

  const { expiresAt, autoDelete } = retention;
  if (autoDelete) {
    return createHistoryRow(userId, toolUsed, outputFileName, fileBuffer.length, expiresAt, metadata);
  }

  const fileId = crypto.randomUUID();
  const diskFileName = `${fileId}${extension}`;

  const storage = getStorage();
  await storage.put(diskFileName, fileBuffer);

  const conversion = await Conversion.create({
    userId,
    toolUsed,
    fileName: outputFileName,
    fileSize: fileBuffer.length,
    status: 'Completed',
    outputUrl: `/api/download/${fileId}`,
    diskFileName: diskFileName,
    metadata,
    expiresAt,
  });

  // Passive background cleanup routine
  cleanupStorage().catch(err => console.error("Storage cleanup failed:", err));

  return conversion;
}

/**
 * Logs a conversion to Recent Activity without keeping its output, for tools whose
 * history rows are deliberately not re-downloadable.
 */
export async function recordConversionHistory(
  userId: string,
  toolUsed: string,
  fileName: string,
  fileSize: number,
  metadata?: Record<string, unknown>
) {
  const retention = await resolveRetention(userId);
  if (!retention) return null;

  return createHistoryRow(userId, toolUsed, fileName, fileSize, retention.expiresAt, metadata);
}

async function storedFileNames(model: typeof Conversion): Promise<Set<string>> {
  const rows: { diskFileName?: string }[] = await model.find({ diskFileName: { $exists: true } }, 'diskFileName');
  return new Set(rows.map(row => row.diskFileName).filter((name): name is string => Boolean(name)));
}

/**
 * Deletes local files that no row records, as a crash between storing a file and creating
 * its row leaves, in the folders of STORED_FILE_KINDS. Any other folder is left alone.
 * Expired files still have their rows: lib/retention-sweep.ts deletes those, on every driver.
 * Local-disk only: for orphans an S3-backed deployment relies on bucket lifecycle rules.
 */
export async function cleanupStorage() {
  const storage = getStorage();
  if (!(storage instanceof LocalDiskStorage)) return;

  await dbConnect();

  const validNamesByFolder = new Map<string, Set<string>>();
  for (const { folder, model } of STORED_FILE_KINDS) {
    validNamesByFolder.set(folder, await storedFileNames(model));
  }

  await storage.sweepOrphaned(validNamesByFolder);
}
