import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import dbConnect from '@/lib/db/mongoose';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import UserDocumentModel from '@/models/userDocument';
import { cookies } from 'next/headers';
import { getStorage } from '@/lib/storage';

async function deleteStoredFiles(keys: string[]) {
  const storage = getStorage();
  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key);
      } catch (err) {
        console.error(`Failed to delete physical file: ${key}`, err);
      }
    })
  );
}

export async function DELETE(req: NextRequest) {
  try {
    await dbConnect();
    const userId = await getAuthUserId(req);

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Delete physical files from Conversion and UserDocument records
    const conversions: { diskFileName?: string }[] = await Conversion.find({ userId });
    const documents: { diskFileName: string }[] = await UserDocumentModel.find({ userId });
    await deleteStoredFiles([
      ...conversions.flatMap((conv) => (conv.diskFileName ? [conv.diskFileName] : [])),
      ...documents.map((doc) => `docs/${doc.diskFileName}`),
    ]);

    // 2. Delete Conversion and UserDocument records
    await Conversion.deleteMany({ userId });
    await UserDocumentModel.deleteMany({ userId });

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
