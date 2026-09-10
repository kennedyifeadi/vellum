import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import Conversion from '@/models/conversion';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';
import mongoose from 'mongoose';
import { resolvePlanLimit } from '@/lib/plan-limits';

export const dynamic = 'force-dynamic';

const GB = 1024 * 1024 * 1024;

export async function GET(req: NextRequest) {
  try {
    console.debug(`[API/Storage] Fetching storage: ${req.url}`);
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await dbConnect();

    const user = await User.findById(userId).lean() as { plan?: string } | null;
    const plan = (user?.plan as string) ?? 'Basic';
    const limitBytes = resolvePlanLimit(plan, {
      guest: 5 * GB,
      Basic: 5 * GB,
      Pro: 20 * GB,
      Enterprise: 100 * GB,
    });

    const agg = await Conversion.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: '$fileSize' } } },
    ]);

    const usedBytes: number = agg[0]?.total ?? 0;

    return NextResponse.json({ usedBytes, limitBytes, plan });
  } catch (error) {
    console.error('[API/Storage] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch storage' }, { status: 500 });
  }
}
