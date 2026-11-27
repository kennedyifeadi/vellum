import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import { cookies } from 'next/headers';
import { deleteAccount } from '@/lib/account-deletion';
import { clearSessionCookies } from '@/lib/auth/session';
import { isRateLimited, tooManyRequests } from '@/lib/http/rate-limit';

const DELETED_MESSAGE = 'Account deleted, with its conversion history, stored documents and compressed videos';
const FILES_PENDING_MESSAGE =
  'Account deleted. Some of its files could not be deleted yet, so deleting them will be retried.';

export async function DELETE(req: NextRequest) {
  if (isRateLimited(req.headers)) return tooManyRequests();

  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { filesPending } = await deleteAccount(userId);

    clearSessionCookies(await cookies());

    const body = filesPending ? { message: FILES_PENDING_MESSAGE, filesPending } : { message: DELETED_MESSAGE };
    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    console.error('Error deleting account:', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
