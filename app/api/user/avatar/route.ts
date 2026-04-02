import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import dbConnect from "@/lib/db/mongoose";
import { verifyToken } from "@/lib/auth/jwt";
import { getToken } from "next-auth/jwt";
import User from "@/models/user";

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

    const { base64Image } = await req.json();
    if (!base64Image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Optional: Size limit check (e.g., 2MB)
    if (base64Image.length > 3 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image is too large (max 2MB)' }, { status: 400 });
    }

    const user = await User.findById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    user.image = base64Image;
    await user.save();

    return NextResponse.json({ 
      message: 'Avatar updated successfully', 
      image: user.image 
    });

  } catch (error) {
    console.error('Avatar Update Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
