import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import JSZip from 'jszip';

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const conversions = await Conversion.find({ userId }).lean();

    const zip = new JSZip();

    // Create a folder for the user
    const folder = zip.folder('vellum-export');

    // Add user data
    folder?.file('user-profile.json', JSON.stringify({
      id: user._id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      createdAt: user.createdAt,
      preferences: user.preferences
    }, null, 2));

    // Add conversion history
    folder?.file('conversion-history.json', JSON.stringify(conversions, null, 2));

    // Generate the zip buffer
    const zipBuffer = await zip.generateAsync({ type: 'uint8array' });

    // Return the blob
    return new NextResponse(zipBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="vellum-export.zip"'
      }
    });
  } catch (error) {
    console.error('Error generating export:', error);
    return NextResponse.json({ error: 'Failed to generate export' }, { status: 500 });
  }
}
