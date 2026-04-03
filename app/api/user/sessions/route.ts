import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findById(userId).select('activeSessions tokenVersion');
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(user.activeSessions || [], { status: 200 });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sessionId, all } = await req.json();

    if (all) {
      // Revoke all other sessions by bumping token version and clearing active sessions list
      // Leave one dummy session representing the current (we'll just clear all and let the current user login again, or just clear all)
      await User.findByIdAndUpdate(userId, { 
        $inc: { tokenVersion: 1 }, 
        $set: { activeSessions: [] } 
      });

      // Clear current cookie as well so they log back in fresh
      const cookieStore = await cookies();
      cookieStore.delete('auth-token');

      return NextResponse.json({ message: 'All sessions revoked' }, { status: 200 });
    }

    if (sessionId) {
      await User.findByIdAndUpdate(userId, {
        $pull: { activeSessions: { id: sessionId } }
      });
      return NextResponse.json({ message: 'Session revoked' }, { status: 200 });
    }

    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  } catch (error) {
    console.error('Error revoking sessions:', error);
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 });
  }
}
