import crypto from 'crypto';
import Conversion from '@/models/conversion';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { getStorage, LocalDiskStorage } from '@/lib/storage';

/**
 * Saves a generated file buffer to local storage and logs it to the database for Recent Activity.
 */
export async function saveConversionRecord(
  userId: string,
  toolUsed: string,
  originalFileName: string,
  fileBuffer: Buffer
) {
  await dbConnect();

  const user = await User.findById(userId);
  if (!user) {
    console.warn(`User ${userId} not found, skipping conversion record saving.`);
    return null;
  }

  const isPro = user.plan === 'Pro';
  const autoDelete = user.preferences?.autoDelete === true;
  
  // If autoDelete is true, set expiresAt to basically immediately so cleanupStorage picks it up instantly.
  // Otherwise, default to 5 days for Pro, 3 days for Free.
  const daysToKeep = isPro ? 5 : 3;
  const expiresAt = autoDelete 
    ? new Date(Date.now() + 1000) // Expires in 1 second
    : new Date(Date.now() + daysToKeep * 24 * 60 * 60 * 1000);

  const fileId = crypto.randomUUID();
  const extension = originalFileName.endsWith('.zip') ? '.zip' : '.pdf';
  const diskFileName = `${fileId}${extension}`;

  const storage = getStorage();
  await storage.put(diskFileName, fileBuffer);

  // Save database record with TTL index
  const conversion = await Conversion.create({
    userId,
    toolUsed,
    fileName: originalFileName,
    fileSize: fileBuffer.length,
    status: 'Completed',
    outputUrl: `/api/download/${fileId}`,
    diskFileName: diskFileName,
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
