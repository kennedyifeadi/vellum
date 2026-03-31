import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import UserDocumentModel from '@/models/userDocument';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

export const dynamic = 'force-dynamic';

const PLAN_LIMITS: Record<string, number> = {
  Free: 50 * 1024 * 1024,
  Pro: 100 * 1024 * 1024,
};
const PLAN_TTL_DAYS: Record<string, number> = {
  Free: 3,
  Pro: 5,
};

export async function POST(req: NextRequest) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await dbConnect();

  const user = await User.findById(userId).lean() as { plan?: string } | null;
  const plan = (user?.plan as string) ?? 'Free';
  const limitBytes = PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free;
  const ttlDays = PLAN_TTL_DAYS[plan] ?? 3;

  // Calculate current storage usage (conversions + staged docs)
  const uid = new mongoose.Types.ObjectId(userId);
  const [convAgg, docAgg] = await Promise.all([
    Conversion.aggregate([{ $match: { userId: uid } }, { $group: { _id: null, total: { $sum: '$fileSize' } } }]),
    UserDocumentModel.aggregate([{ $match: { userId: uid } }, { $group: { _id: null, total: { $sum: '$fileSize' } } }]),
  ]);
  const currentUsed = (convAgg[0]?.total ?? 0) + (docAgg[0]?.total ?? 0);

  const formData = await req.formData();
  const files = formData.getAll('files') as File[];

  if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

  const docsDir = path.join(process.cwd(), 'tmp', 'storage', 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  let usedSoFar = currentUsed;
  const created = [];

  for (const file of files) {
    if (usedSoFar + file.size > limitBytes) {
      return NextResponse.json(
        { error: `Storage limit reached. Cannot upload "${file.name}". Upgrade to Pro for more space.` },
        { status: 507 }
      );
    }

    const ext = path.extname(file.name);
    const diskFileName = `${uuidv4()}${ext}`;
    const filePath = path.join(docsDir, diskFileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    const doc = await UserDocumentModel.create({
      userId,
      fileName: file.name,
      diskFileName,
      fileSize: file.size,
      mimeType: file.type,
      expiresAt,
    });

    usedSoFar += file.size;
    created.push(doc);
  }

  return NextResponse.json(created, { status: 201 });
}
