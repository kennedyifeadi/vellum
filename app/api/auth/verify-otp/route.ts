import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { createToken } from '@/lib/auth/jwt';
import User from '@/models/user';

export async function POST(req: NextRequest) {
  try {
    const { email, otp } = await req.json();
    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required.' }, { status: 400 });
    }

    const isValidOtp = await verifyOtp(email, otp);

    if (!isValidOtp) {
      return NextResponse.json({ error: 'Invalid or expired OTP.' }, { status: 401 });
    }

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      // New user, create a temporary record and flag for profile completion
      user = await User.create({ email, isProfileComplete: false });
      isNewUser = true;
    }

    const token = await createToken({ userId: user._id, email: user.email, isProfileComplete: user.isProfileComplete });

    const response = NextResponse.json({ message: 'OTP verified.', isNewUser, user: { email: user.email, isProfileComplete: user.isProfileComplete } }, { status: 200 });
    response.cookies.set('auth_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 2 } ); // 2 hours
    return response;
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return NextResponse.json({ error: 'Failed to verify OTP.' }, { status: 500 });
  }
}