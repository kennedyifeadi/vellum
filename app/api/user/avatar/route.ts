import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db/mongoose";
import { getAuthUserId } from "@/lib/auth/jwt";
import User from "@/models/user";
import { ClientError } from "@/lib/convert/errors";
import { JSON_BODY_LIMIT_BYTES, readJsonRequest } from "@/lib/http/read-upload";
import { isRateLimited, tooManyRequests } from '@/lib/http/rate-limit';

const MAX_IMAGE_LENGTH = 3 * 1024 * 1024;
// The image and room for the rest of the object around it.
const MAX_BODY_BYTES = MAX_IMAGE_LENGTH + JSON_BODY_LIMIT_BYTES;

export async function POST(req: NextRequest) {
  if (isRateLimited(req.headers)) return tooManyRequests();

  try {
    await dbConnect();
    const userId = await getAuthUserId(req);
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
