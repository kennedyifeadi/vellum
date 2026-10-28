import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import { storageLimits } from '@/lib/storage-limits';
import { usedStorageBytes } from '@/lib/storage-usage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    console.debug(`[API/Storage] Fetching storage: ${req.url}`);
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await dbConnect();

    const user = await User.findById(userId).lean() as { plan?: string } | null;
    const plan = (user?.plan as string) ?? 'Basic';
    const limitBytes = storageLimits(plan).quotaBytes;
    const usedBytes = await usedStorageBytes(userId);

    return NextResponse.json({ usedBytes, limitBytes, plan });
  } catch (error) {
    console.error('[API/Storage] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch storage' }, { status: 500 });
  }
}
