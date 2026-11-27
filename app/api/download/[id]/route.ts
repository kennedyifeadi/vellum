import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import { getStorage } from '@/lib/storage';
import { STORED_EXTENSIONS, storedContentType } from '@/lib/conversions';
import { attachmentDisposition } from '@/lib/http/content-disposition';
import { storedFileResponse } from '@/lib/http/stored-file-response';
import { unexpired } from '@/lib/stored-files';
import { isReadRateLimited, tooManyRequests } from '@/lib/http/rate-limit';

// saveConversionRecord names stored files after crypto.randomUUID(), which is lowercase.
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const notFound = () => NextResponse.json({ error: 'File not found or unauthorized' }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isReadRateLimited(req.headers)) return tooManyRequests();

  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!FILE_ID.test(id)) {
      return notFound();
    }

    await dbConnect();

    const conversion = await Conversion.findOne({
      userId,
      ...unexpired(),
      diskFileName: { $in: STORED_EXTENSIONS.map(extension => `${id}${extension}`) },
    });

    if (!conversion) {
      return notFound();
    }

    const storage = getStorage();
    const file = await storage.openRead(conversion.diskFileName);
    if (!file) {
      return NextResponse.json({ error: 'File has expired and was removed' }, { status: 404 });
    }

    return storedFileResponse(req, file, {
      'Content-Type': storedContentType(conversion.diskFileName) ?? 'application/octet-stream',
      'Content-Disposition': attachmentDisposition(conversion.fileName, 'download'),
    }, `conversion download ${conversion.diskFileName}`);

  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
  }
}
