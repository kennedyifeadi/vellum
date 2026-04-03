import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';

export async function DELETE(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Delete physical files from Conversion records
    const conversions = await Conversion.find({ userId });
    const storageDir = path.join(process.cwd(), 'tmp', 'storage');
    
    if (fs.existsSync(storageDir)) {
      conversions.forEach((conv) => {
        if (conv.diskFileName) {
          const filePath = path.join(storageDir, conv.diskFileName);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (err) {
              console.error(`Failed to delete physical file: ${filePath}`, err);
            }
          }
        }
      });
    }

    // 2. Delete Conversion records
    await Conversion.deleteMany({ userId });

    // 3. Delete the User record
    await User.findByIdAndDelete(userId);

    // 4. Destroy active session cookie
    const cookieStore = await cookies();
    cookieStore.delete('auth-token');

    return NextResponse.json({ message: 'Account and all data successfully deleted' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting account:', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
