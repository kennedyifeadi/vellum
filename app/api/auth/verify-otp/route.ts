import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp } from '@/lib/auth/verifyOtp';
import { readBrowserId, setKnownDevice } from '@/lib/auth/signInCookies';
import { isJsonRequest, isValidEmail, parseOtpCode } from '@/lib/auth/signInInput';
import { createToken } from '@/lib/auth/jwt';
import { buildSessionEntry } from '@/lib/auth/session';
import User from '@/models/user';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db/mongoose';
import { ClientError } from '@/lib/convert/errors';
import { readJsonRequest } from '@/lib/http/read-upload';

export async function POST(req: NextRequest) {
  try {
    if (!isJsonRequest(req)) {
      return NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415 });
    }

    const { email, code: typedCode } = await readJsonRequest(req, 'Invalid JSON body.');
    const code = parseOtpCode(typedCode);

    if (!isValidEmail(email) || !code) {
      return NextResponse.json({ error: 'A valid email address and eight-character code are required.' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const browserId = readBrowserId(cookieStore);
    if (!browserId) {
      return NextResponse.json(
        { error: 'Enter the code in the browser that requested it, or request a new code.' },
        { status: 401 },
      );
    }

    await dbConnect();
    const deviceId = await verifyOtp(browserId, email, code);

    if (!deviceId) {
      return NextResponse.json({ error: 'Invalid or expired OTP.' }, { status: 401 });
    }

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      user = await User.create({
        email,
        isProfileComplete: false,
        plan: 'Basic',
      });
      isNewUser = true;
    }

    const token = await createToken({
      userId: user._id.toString(),
      email: user.email,
      isProfileComplete: user.isProfileComplete,
      tokenVersion: user.tokenVersion,
    });

    await User.findByIdAndUpdate(user._id, {
      $push: { activeSessions: buildSessionEntry(req) },
    });

    setKnownDevice(cookieStore, email, deviceId);
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
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error verifying OTP:', error);
    return NextResponse.json({ error: 'Failed to verify OTP.' }, { status: 500 });
  }
}