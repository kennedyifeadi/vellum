import type { NextRequest } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';

export interface Caller {
  userId: string | null;
  /** The signed-in user's plan; 'Free' for a guest or a user without one. */
  plan: string;
}

/** Who is calling and on which plan, which an upload route needs before reading the upload. */
export async function resolveCaller(req: NextRequest): Promise<Caller> {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return { userId, plan: 'Free' };
  }

  await dbConnect();
  const user = await User.findById(userId);
  return { userId, plan: user?.plan || 'Free' };
}
