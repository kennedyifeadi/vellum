import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, createToken } from '@/lib/auth/jwt';
import User from '@/models/user';

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth_token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.isProfileComplete) {
      return NextResponse.json({ error: 'Profile already complete or invalid token.' }, { status: 400 });
    }

    const { name, role } = await req.json();
    if (!name || !role) {
      return NextResponse.json({ error: 'Name and role are required.' }, { status: 400 });
    }

    const user = await User.findByIdAndUpdate(
      payload.userId,
      { name, role, isProfileComplete: true },
      { new: true }
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    // Re-issue token with updated profile status
    const newToken = await createToken({ userId: user._id, email: user.email, isProfileComplete: user.isProfileComplete });

    const response = NextResponse.json({ message: 'Profile completed successfully.', user: { name: user.name, role: user.role, email: user.email } }, { status: 200 });
    response.cookies.set('auth_token', newToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 2 } );
    return response;
  } catch (error) {
    console.error('Error completing profile:', error);
    return NextResponse.json({ error: 'Failed to complete profile.' }, { status: 500 });
  }
}