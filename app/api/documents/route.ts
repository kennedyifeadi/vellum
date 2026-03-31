import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import UserDocumentModel from '@/models/userDocument';
import dbConnect from '@/lib/db/mongoose';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await dbConnect();
  const docs = await UserDocumentModel.find({ userId })
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json(docs);
}

export async function DELETE(req: NextRequest) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  await dbConnect();
  const doc = await UserDocumentModel.findOneAndDelete({ _id: id, userId });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Delete physical file
  const filePath = path.join(process.cwd(), 'tmp', 'storage', 'docs', doc.diskFileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  return NextResponse.json({ success: true });
}
