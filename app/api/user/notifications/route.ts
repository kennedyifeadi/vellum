import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';
import { pushNotification } from '@/lib/notifications';

// GET — return the user's notifications (newest first)
export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await User.findById(userId).select('notifications');
    const notifications = (user?.notifications ?? []).slice().reverse(); // newest first
    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('GET /api/user/notifications error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST — add a new notification (keeps last 50)
export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { type, title, message, link } = await req.json();
    if (!type || !title || !message) {
      return NextResponse.json({ error: 'type, title, and message are required' }, { status: 400 });
    }

    const newNotification = await pushNotification(userId, { type, title, message, link });

    return NextResponse.json({ notification: newNotification }, { status: 201 });
  } catch (error) {
    console.error('POST /api/user/notifications error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH — mark all notifications as read
export async function PATCH(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await User.findByIdAndUpdate(userId, {
      $set: { 'notifications.$[].isRead': true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PATCH /api/user/notifications error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
