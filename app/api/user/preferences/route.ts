import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';

export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findById(userId).select('preferences');
    
    // Return preferences or a default payload if undefined
    const prefs = user?.preferences || {
      theme: 'system',
      autoDelete: false,
      notifications: { email: true, marketing: false, updates: true }
    };

    return NextResponse.json(prefs, { status: 200 });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const updateData = await req.json();

    // Map payload accurately to the schema structure
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { preferences: updateData } },
      { new: true }
    ).select('preferences');

    return NextResponse.json(updatedUser?.preferences, { status: 200 });
  } catch (error) {
    console.error('Error updating preferences:', error);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
}
