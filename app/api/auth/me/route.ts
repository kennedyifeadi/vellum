import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import dbConnect from "@/lib/db/mongoose";
import { verifyToken } from "@/lib/auth/jwt";
import { getToken } from "next-auth/jwt";
import User from "@/models/user";

export async function GET(req: NextRequest) {
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

    const user = await User.findById(userId).select('-otpCode -otpExpiry');
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
