import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db/mongoose";
import { getAuthUserId } from "@/lib/auth/jwt";
import User from "@/models/user";
import { ClientError } from "@/lib/convert/errors";
import { readJsonRequest } from "@/lib/http/read-upload";
import { optionalName } from "@/lib/http/text-input";
import { isRateLimited, tooManyRequests } from '@/lib/http/rate-limit';

export async function PATCH(req: NextRequest) {
  if (isRateLimited(req.headers)) return tooManyRequests();

  try {
    await dbConnect();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name: submittedName, currentGoal } = await readJsonRequest(req, 'Internal Server Error');
    const name = optionalName(submittedName);

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
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Profile Update Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
