import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, createToken } from '@/lib/auth/jwt';
import User from '@/models/user';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/db/mongoose';
import { BrevoClient } from '@getbrevo/brevo';
import { getWelcomeEmailHtml } from '@/lib/email/templates/welcomeEmail';
import { getToken } from 'next-auth/jwt';

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

    // 2. Fallback: NextAuth session (Google/Microsoft OAuth)
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

    const { name, role, currentGoal } = await req.json();

    if (!name || !role) {
      return NextResponse.json({ error: 'Name and role are required' }, { status: 400 });
    }

    const user = await User.findByIdAndUpdate(
      userId,
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

    // Re-issue a custom JWT with the updated profile completion status
    // This ensures the middleware works seamlessly for all auth flows
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

    // Send Welcome Email
    if (process.env.BREVO_API_KEY && process.env.BREVO_API_KEY !== "YOUR_BREVO_API_KEY") {
      try {
        const client = new BrevoClient({ 
          apiKey: process.env.BREVO_API_KEY as string 
        });

        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
        const dashboardUrl = `${baseUrl}/dashboard`;

        await client.transactionalEmails.sendTransacEmail({
          subject: `Welcome to Vellum, ${user.name}!`,
          htmlContent: getWelcomeEmailHtml(user.name || 'there', dashboardUrl),
          sender: { name: "JFK from Vellum", email: process.env.EMAIL_USER as string },
          to: [{ email: user.email }],
        });

      } catch (emailError: any) {
        console.error('Failed to send welcome email:', emailError);
        // We don't fail the whole request if email fails
      }
    } else {
        console.log(`[WELCOME] Skipping email send for ${user.email} (API key not configured).`);
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
    console.error('Error completing profile:', error);
    return NextResponse.json({ error: 'Failed to complete profile' }, { status: 500 });
  }
}