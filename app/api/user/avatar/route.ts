import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import dbConnect from "@/lib/db/mongoose";
import { verifyToken } from "@/lib/auth/jwt";
import { getToken } from "next-auth/jwt";
import User from "@/models/user";
import { ClientError } from "@/lib/convert/errors";
import { JSON_BODY_LIMIT_BYTES, readJsonRequest } from "@/lib/http/read-upload";

const MAX_IMAGE_LENGTH = 3 * 1024 * 1024;
// The image and room for the rest of the object around it.
const MAX_BODY_BYTES = MAX_IMAGE_LENGTH + JSON_BODY_LIMIT_BYTES;

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

    const { base64Image } = (await readJsonRequest(req, 'Internal Server Error', MAX_BODY_BYTES)) as { base64Image?: string };
    if (!base64Image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // Optional: Size limit check (e.g., 2MB)
    if (base64Image.length > MAX_IMAGE_LENGTH) {
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
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Avatar Update Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
