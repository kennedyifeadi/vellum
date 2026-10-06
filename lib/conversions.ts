import crypto from 'crypto';
import path from 'path';
import Conversion from '@/models/conversion';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { getStorage, LocalDiskStorage } from '@/lib/storage';

const STORED_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
};

function storedExtension(fileName: string): string | null {
  const extension = path.extname(fileName).toLowerCase();
  return extension in STORED_CONTENT_TYPES ? extension : null;
}

export function storedContentType(fileName: string): string | null {
  const extension = storedExtension(fileName);
  return extension ? STORED_CONTENT_TYPES[extension] : null;
}

/**
 * Resolves when a user's history row expires, or null when the user no longer exists.
 */
async function resolveExpiry(userId: string): Promise<Date | null> {
  await dbConnect();

  const user = await User.findById(userId);
  if (!user) {
    console.warn(`User ${userId} not found, skipping conversion record saving.`);
    return null;
  }

  const extendedRetention = user.plan === 'Pro' || user.plan === 'Enterprise';
  const autoDelete = user.preferences?.autoDelete === true;

  // If autoDelete is true, set expiresAt to basically immediately so cleanupStorage picks it up instantly.
  // Otherwise, default to 5 days for Pro/Enterprise, 3 days for Basic/guest.
  const daysToKeep = extendedRetention ? 5 : 3;
  return autoDelete
    ? new Date(Date.now() + 1000) // Expires in 1 second
    : new Date(Date.now() + daysToKeep * 24 * 60 * 60 * 1000);
}

/**
 * Saves a generated file buffer to storage and logs it to the database for Recent Activity.
 * `outputFileName` is the name the file is re-downloaded under; its extension decides the stored type.
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

  const expiresAt = await resolveExpiry(userId);
  if (!expiresAt) return null;

  const fileId = crypto.randomUUID();
  const diskFileName = `${fileId}${extension}`;

  const storage = getStorage();
  await storage.put(diskFileName, fileBuffer);

  // Save database record with TTL index
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
 * Sweeps the local storage directory and deletes any physical files that no longer
 * exist in the MongoDB Conversion collection (due to TTL deletion or manual deletion).
 * Local-disk only: an S3-backed deployment relies on bucket lifecycle rules instead.
 */
export async function cleanupStorage() {
  const storage = getStorage();
  if (!(storage instanceof LocalDiskStorage)) return;

  await dbConnect();

  const validConversions = await Conversion.find({ diskFileName: { $exists: true } }, 'diskFileName');
  const validFileNames = new Set(validConversions.map(c => c.diskFileName).filter(Boolean));

  await storage.sweepOrphaned(validFileNames);
}
