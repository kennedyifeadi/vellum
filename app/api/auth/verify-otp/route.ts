import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { createToken } from '@/lib/auth/jwt';
import User from '@/models/user';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db/mongoose';

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const { email, code } = await req.json();

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and OTP are required.' }, { status: 400 });
    }

    const isValid = await verifyOtp(email, code);

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid or expired OTP.' }, { status: 401 });
    }

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      user = await User.create({
        email,
        isProfileComplete: false,
        plan: 'Free',
      });
      isNewUser = true;
    }

    const token = await createToken({
      userId: user._id.toString(),
      email: user.email,
      isProfileComplete: user.isProfileComplete,
    });

    const cookieStore = await cookies();
    cookieStore.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 2, // 2 hours
    });

    return NextResponse.json({
      message: 'Login successful',
      isNewUser,
      user: {
        email: user.email,
        isProfileComplete: user.isProfileComplete,
      },
    }, { status: 200 });

  } catch (error) {
    console.error('Error verifying OTP:', error);
    return NextResponse.json({ error: 'Failed to verify OTP.' }, { status: 500 });
  }
}