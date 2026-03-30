import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
export const dynamic = 'force-dynamic';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  try {
    // Read req.url to silence ESLint unused variable warning
    console.debug(`[API/Conversions] Fetching activity history: ${req.url}`);
    
    const userId = await getAuthUserId(req);
    if (!userId) {
      console.error('[API/Conversions] Unauthorized access.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    
    // Fetch conversions for user, newest first
    const conversions = await Conversion.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return NextResponse.json(conversions);
  } catch (error) {
    console.error('Failed to fetch activity:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    await dbConnect();
    const conversion = await Conversion.findOne({ _id: id, userId });
    if (!conversion) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (conversion.diskFileName) {
      const filePath = path.join(process.cwd(), 'tmp', 'storage', conversion.diskFileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await Conversion.deleteOne({ _id: id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete activity:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
