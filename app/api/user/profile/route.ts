import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import dbConnect from "@/lib/db/mongoose";
import { verifyToken } from "@/lib/auth/jwt";
import { getToken } from "next-auth/jwt";
import User from "@/models/user";

export async function PATCH(req: NextRequest) {
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

    const { name, currentGoal } = await req.json();

    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (name) user.name = name;
    if (currentGoal) user.currentGoal = currentGoal;

    await user.save();

    return NextResponse.json({ 
      message: 'Profile updated successfully',
      user: {
        name: user.name,
        email: user.email,
        currentGoal: user.currentGoal,
        role: user.role,
        image: user.image
      }
    });

  } catch (error: any) {
    console.error('Profile Update Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
