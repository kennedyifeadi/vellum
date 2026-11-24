import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, createToken } from '@/lib/auth/jwt';
import User from '@/models/user';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db/mongoose';
import { ClientError } from '@/lib/convert/errors';
import { reserveWelcomeEmail } from '@/lib/email/daily-limits';
import { emailFailureReason, hasEmailApiKey, sendEmail } from '@/lib/email/send';
import { getWelcomeEmailHtml } from '@/lib/email/templates/welcomeEmail';
import { readJsonRequest } from '@/lib/http/read-upload';
import { MAX_NAME_LENGTH, requiredLine } from '@/lib/http/text-input';
import { getToken } from 'next-auth/jwt';

async function sendWelcomeEmail(userId: string, name: string, email: string) {
  if (!hasEmailApiKey()) {
    console.log(`[WELCOME] Skipping email send for user ${userId} (API key not configured).`);
    return;
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  try {
    if (!(await reserveWelcomeEmail())) {
      console.log(`[WELCOME] Not sending a welcome email to user ${userId}: today's are used up.`);
      return;
    }
    await sendEmail({
      senderName: 'JFK from Vellum',
      to: email,
      // Brevo evaluates {{ }} in subjects too, and they are plain text, so can't be escaped.
      subject: `Welcome to Vellum, ${name.replace(/[{}]/g, '')}!`,
      html: getWelcomeEmailHtml(name, `${baseUrl}/dashboard`),
    });
  } catch (emailError) {
    // We don't fail the whole request if email fails
    console.error(`Failed to send welcome email to user ${userId}: ${emailFailureReason(emailError)}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const cookieStore = await cookies();
    const customToken = cookieStore.get('auth-token')?.value;
    let userId: string | null = null;

    // 1. Try custom JWT auth (OTP flow)
    if (customToken) {
      const payload = await verifyToken(customToken);
      if (payload?.userId) {
        userId = payload.userId as string;
      }
    }

    // 2. Fallback: NextAuth session (Google OAuth)
    if (!userId) {
      const nextAuthToken = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
      if (nextAuthToken?.email) {
        const existingUser = await User.findOne({ email: nextAuthToken.email });
        if (existingUser) {
          userId = existingUser._id.toString();
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name: submittedName, role, currentGoal } = await readJsonRequest(req, 'Failed to complete profile');

    if (!submittedName || !role) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    const name = requiredLine(submittedName, 'Name', MAX_NAME_LENGTH);
    const profile = { name, role, currentGoal, isProfileComplete: true };

    // The filter and the update are one operation, so of two racing requests only one matches.
    const newlyCompleted = await User.findOneAndUpdate(
      { _id: userId, isProfileComplete: { $ne: true } },
      profile,
      { new: true }
    );
    const user = newlyCompleted ?? (await User.findByIdAndUpdate(userId, profile, { new: true }));

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Re-issue a custom JWT with the updated profile completion status
    // This ensures the middleware works seamlessly for all auth flows
    const newToken = await createToken({
      userId: user._id.toString(),
      email: user.email,
      isProfileComplete: true,
      tokenVersion: user.tokenVersion,
    });

    cookieStore.set('auth-token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 2, // 2 hours
    });

    if (newlyCompleted) {
      await sendWelcomeEmail(userId, name, user.email);
    }

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
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error completing profile:', error);
    return NextResponse.json({ error: 'Failed to complete profile' }, { status: 500 });
  }
}