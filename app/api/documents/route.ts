import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import UserDocumentModel from '@/models/userDocument';
import dbConnect from '@/lib/db/mongoose';
import { DOCUMENT_FILES, removeStoredFile, unexpired } from '@/lib/stored-files';
import { isRateLimited, isReadRateLimited, tooManyRequests } from '@/lib/http/rate-limit';
import { isObjectId } from '@/lib/db/object-id';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (isReadRateLimited(req.headers)) return tooManyRequests();

  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await dbConnect();
  const docs = await UserDocumentModel.find({ userId, ...unexpired() })
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json(docs);
}

export async function DELETE(req: NextRequest) {
  if (isRateLimited(req.headers)) return tooManyRequests();

  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  if (!isObjectId(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await dbConnect();
  const doc = await UserDocumentModel.findOne({ _id: id, userId, ...unexpired() });
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!(await removeStoredFile(DOCUMENT_FILES, doc))) {
    return NextResponse.json({ filesPending: true }, { status: 202 });
  }

  return NextResponse.json({ success: true });
}
