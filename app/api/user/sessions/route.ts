import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, getAuthUserId } from '@/lib/auth/jwt';
import { clearSessionCookies, endAllSessions, endSession, type SessionEntry } from '@/lib/auth/session';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';
import { cookies } from 'next/headers';
import { ClientError } from '@/lib/convert/errors';
import { readJsonRequest } from '@/lib/http/read-upload';

export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const session = await getAuthSession(req);

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findById(session.userId).select('activeSessions');
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const sessions = (user.activeSessions || []).map(({ id, device, location, lastActive }: SessionEntry) => ({
      id,
      device,
      location,
      lastActive,
      current: id === session.sessionId,
    }));
    return NextResponse.json(sessions, { status: 200 });
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

    const { sessionId, all } = await readJsonRequest(req, 'Failed to revoke sessions');

    if (all) {
      await endAllSessions(userId);
      clearSessionCookies(await cookies());

      return NextResponse.json({ message: 'All sessions revoked' }, { status: 200 });
    }

    if (typeof sessionId === 'string' && sessionId) {
      await endSession(userId, sessionId);
      return NextResponse.json({ message: 'Session revoked' }, { status: 200 });
    }

    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error revoking sessions:', error);
    return NextResponse.json({ error: 'Failed to revoke sessions' }, { status: 500 });
  }
}
