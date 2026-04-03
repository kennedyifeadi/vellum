import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import Conversion from '@/models/conversion';
import User from '@/models/user';

export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findById(userId).select('plan');
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get exact count of all conversions processed by this user
    const processedFilesCount = await Conversion.countDocuments({ userId });

    return NextResponse.json({
      plan: user.plan,
      processedFiles: processedFilesCount
    }, { status: 200 });
  } catch (error) {
    console.error('Error fetching billing stats:', error);
    return NextResponse.json({ error: 'Failed to fetch billing data' }, { status: 500 });
  }
}
