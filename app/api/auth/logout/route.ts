import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthSessions } from '@/lib/auth/jwt';
import { clearSessionCookies, endSession } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  try {
    for (const { userId, sessionId } of await getAuthSessions(req)) {
      await endSession(userId, sessionId);
    }
    clearSessionCookies(await cookies());

    return NextResponse.json({ message: 'Logged out successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error logging out:', error);
    return NextResponse.json({ error: 'Failed to log out' }, { status: 500 });
  }
}
