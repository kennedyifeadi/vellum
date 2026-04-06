import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';

// GET — return the user's starred tool IDs
export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await User.findById(userId).select('starredTools');
    return NextResponse.json({ starredTools: user?.starredTools ?? [] });
  } catch (error) {
    console.error('GET /api/user/starred error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH — toggle a tool ID in the starred list
export async function PATCH(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { toolId } = await req.json();
    if (!toolId || typeof toolId !== 'string') {
      return NextResponse.json({ error: 'toolId is required' }, { status: 400 });
    }

    const user = await User.findById(userId).select('starredTools');
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const current: string[] = user.starredTools ?? [];
    const isStarred = current.includes(toolId);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      isStarred
        ? { $pull: { starredTools: toolId } }
        : { $addToSet: { starredTools: toolId } },
      { new: true }
    ).select('starredTools');

    return NextResponse.json({ starredTools: updatedUser?.starredTools ?? [] });
  } catch (error) {
    console.error('PATCH /api/user/starred error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
