import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import UserDocumentModel from '@/models/userDocument';
import dbConnect from '@/lib/db/mongoose';
import { getStorage } from '@/lib/storage';
import { attachmentDisposition } from '@/lib/http/content-disposition';

// A stored document's type is whatever its uploader claimed, so it is only passed on for
// types a browser will not run as a page or script; anything else is served as bytes.
const SERVABLE_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
]);

function servedContentType(claimedType: unknown): string {
  const type = String(claimedType ?? '').split(';')[0].trim().toLowerCase();
  return SERVABLE_DOCUMENT_TYPES.has(type) ? type : 'application/octet-stream';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    await dbConnect();
    
    const doc = await UserDocumentModel.findOne({ _id: id, userId });
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const storage = getStorage();
    const fileBuffer = await storage.get(`docs/${doc.diskFileName}`);
    if (!fileBuffer) {
      return NextResponse.json({ error: 'File removed from storage' }, { status: 404 });
    }

    return new NextResponse(fileBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': servedContentType(doc.mimeType),
        'Content-Disposition': attachmentDisposition(doc.fileName, 'download'),
        'X-Content-Type-Options': 'nosniff',
      },
    });

  } catch (error) {
    console.error('[API/Documents/Download] Error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
