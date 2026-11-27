import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/db/mongoose";
import { getAuthUserId } from "@/lib/auth/jwt";
import User from "@/models/user";
import { isReadRateLimited, tooManyRequests } from "@/lib/http/rate-limit";

// What the dashboard, its settings tabs and the Solutions tool host read from the signed-in user.
const SHOWN_FIELDS = ['_id', 'name', 'email', 'image', 'plan', 'role', 'currentGoal'] as const;

type ShownUser = Partial<Record<(typeof SHOWN_FIELDS)[number], unknown>>;

function shownUser(user: ShownUser): ShownUser {
  return Object.fromEntries(SHOWN_FIELDS.filter((field) => user[field] !== undefined).map((field) => [field, user[field]]));
}

export async function GET(req: NextRequest) {
  if (isReadRateLimited(req.headers)) return tooManyRequests();

  try {
    await dbConnect();
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findById(userId).select(SHOWN_FIELDS.join(' ')).lean<ShownUser>();
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user: shownUser(user) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
