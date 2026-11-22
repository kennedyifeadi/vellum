import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { getStorage } from '@/lib/storage';
import path from 'path';
import { randomUUID } from 'crypto';
import { retentionExpiry, storageFullMessage, storageLimits } from '@/lib/storage-limits';
import { usedStorageBytes } from '@/lib/storage-usage';
import { DOCUMENT_FILES, recordForAccount } from '@/lib/stored-files';
import { ACCOUNT_MISSING_MESSAGE } from '@/lib/account';
import { ClientError } from '@/lib/convert/errors';
import { readMultipartForm, uploadBudget, uploadedFiles } from '@/lib/http/read-upload';
import { isRateLimited, RATE_LIMITED_MESSAGE } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

const accountMissing = () => NextResponse.json({ error: ACCOUNT_MISSING_MESSAGE }, { status: 401 });

const SAFE_EXTENSION = /^\.[a-z0-9]{1,10}$/i;

function storageExtension(fileName: string): string {
  const ext = path.extname(fileName);
  return SAFE_EXTENSION.test(ext) ? ext : '';
}

export async function POST(req: NextRequest) {
  if (isRateLimited(req.headers)) {
    return NextResponse.json({ error: RATE_LIMITED_MESSAGE }, { status: 429 });
  }

  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await dbConnect();

  const user = await User.findById(userId).lean() as { plan?: string } | null;
  if (!user) return accountMissing();
  const plan = (user.plan as string) ?? 'Basic';
  const limitBytes = storageLimits(plan).quotaBytes;
  const currentUsed = await usedStorageBytes(userId);

  let files: File[];
  try {
    const formData = await readMultipartForm(
      req,
      uploadBudget(
        Math.max(0, limitBytes - currentUsed),
        storageFullMessage(plan),
        507,
      ),
    );
    files = uploadedFiles(formData, 'files');
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

  const storage = getStorage();
  let usedSoFar = currentUsed;
  const created = [];

  for (const file of files) {
    if (usedSoFar + file.size > limitBytes) {
      return NextResponse.json(
        { error: storageFullMessage(plan, file.name) },
        { status: 507 }
      );
    }

    const diskFileName = `${randomUUID()}${storageExtension(file.name)}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await storage.put(`docs/${diskFileName}`, buffer);

    const doc = await recordForAccount(DOCUMENT_FILES, {
      userId,
      fileName: file.name,
      diskFileName,
      fileSize: file.size,
      mimeType: file.type,
      expiresAt: retentionExpiry(plan),
    });
    if (!doc) return accountMissing();

    usedSoFar += file.size;
    created.push(doc);
  }

  return NextResponse.json(created, { status: 201 });
}
