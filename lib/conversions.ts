import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Conversion from '@/models/conversion';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';

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
  
  // Save to local disk tmp/storage
  const storageDir = path.join(process.cwd(), 'tmp', 'storage');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  
  const filePath = path.join(storageDir, diskFileName);
  fs.writeFileSync(filePath, fileBuffer);

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
 */
export async function cleanupStorage() {
  await dbConnect();
  const storageDir = path.join(process.cwd(), 'tmp', 'storage');
  if (!fs.existsSync(storageDir)) return;

  const validConversions = await Conversion.find({ diskFileName: { $exists: true } }, 'diskFileName');
  const validFileNames = new Set(validConversions.map(c => c.diskFileName).filter(Boolean));

  const physicalEntries = fs.readdirSync(storageDir);

  for (const entry of physicalEntries) {
    if (!validFileNames.has(entry)) {
      const entryPath = path.join(storageDir, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          // Subdirectories (e.g. tmp/storage/docs) must be removed recursively
          fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(entryPath);
        }
      } catch (err) {
        console.error(`Failed to delete expired entry ${entry}:`, err);
      }
    }
  }
}
