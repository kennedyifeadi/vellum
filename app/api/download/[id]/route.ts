import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    await dbConnect();
    
    const conversion = await Conversion.findOne({
      userId,
      diskFileName: { $regex: `^${id}` }
    });

    if (!conversion) {
      return NextResponse.json({ error: 'File not found or unauthorized' }, { status: 404 });
    }

    const filePath = path.join(process.cwd(), 'tmp', 'storage', conversion.diskFileName);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File has expired and was removed' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    return new NextResponse(fileBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': conversion.diskFileName.endsWith('.zip') ? 'application/zip' : 'application/pdf',
        'Content-Disposition': `attachment; filename="${conversion.fileName}"`,
      },
    });

  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
  }
}
