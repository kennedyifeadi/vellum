import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, createToken } from '@/lib/auth/jwt';
import User from '@/models/user';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db/mongoose';

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || !payload.userId) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { name, role, currentGoal } = await req.json();

    if (!name || !role) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    const user = await User.findByIdAndUpdate(
      payload.userId,
      {
        name,
        role,
        currentGoal,
        isProfileComplete: true,
      },
      { new: true }
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Re-issue a new JWT with the updated profile completion status
    const newToken = await createToken({
      userId: user._id.toString(),
      email: user.email,
      isProfileComplete: true,
    });

    cookieStore.set('auth-token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 2, // 2 hours
    });

    return NextResponse.json({
      message: 'Profile completed successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        isProfileComplete: user.isProfileComplete,
      },
    }, { status: 200 });

  } catch (error) {
    console.error('Error completing profile:', error);
    return NextResponse.json({ error: 'Failed to complete profile' }, { status: 500 });
  }
}