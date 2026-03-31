import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import UserDocumentModel from '@/models/userDocument';
import dbConnect from '@/lib/db/mongoose';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    await dbConnect();
    
    const doc = await UserDocumentModel.findOne({ _id: id, userId });
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const filePath = path.join(process.cwd(), 'tmp', 'storage', 'docs', doc.diskFileName);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File removed from storage' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    return new NextResponse(fileBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': doc.mimeType,
        'Content-Disposition': `attachment; filename="${doc.fileName}"`,
      },
    });

  } catch (error) {
    console.error('[API/Documents/Download] Error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
