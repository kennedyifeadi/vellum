import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import sharp from 'sharp';
import JSZip from 'jszip';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const images = formData.getAll('images') as File[];
    const level = formData.get('level') as string || 'medium';

    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    await dbConnect();
    const user = await User.findById(userId);
    
    // Check Limits
    const MAX_FREE_FILES = 5;
    const MAX_PRO_FILES = 20;
    const maxAllowed = user?.plan === 'Pro' ? MAX_PRO_FILES : MAX_FREE_FILES;

    if (images.length > maxAllowed) {
      return NextResponse.json({ 
        error: `Your current plan allows up to ${maxAllowed} images per compression.` 
      }, { status: 400 });
    }

    // Determine quality map
    let quality = 80;
    if (level === 'low') quality = 90;
    if (level === 'medium') quality = 80;
    if (level === 'high') quality = 60;

    // Process multiple images vs single image
    if (images.length === 1) {
      const file = images[0];
      const buffer = Buffer.from(await file.arrayBuffer());
      
      const compressedBuffer = await sharp(buffer)
        .jpeg({ quality, mozjpeg: true })
        .png({ quality: quality - 10, palette: true })
        .webp({ quality })
        .toBuffer();

      // Log Conversion
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await Conversion.create({
        userId,
        toolUsed: 'Compress Image',
        fileName: file.name,
        fileSize: file.size,
        status: 'success',
        metadata: { pages: 1, processedSize: compressedBuffer.length },
        expiresAt
      });

      return new NextResponse(compressedBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': file.type || 'image/jpeg',
          'Content-Disposition': `attachment; filename="compressed_${file.name}"`,
          'X-Original-Size': file.size.toString(),
          'X-Compressed-Size': compressedBuffer.length.toString(),
          'X-Saved-Percent': Math.max(0, Math.round((1 - compressedBuffer.length / file.size) * 100)).toString()
        },
      });
    } else {
      // Multiple Images - Create ZIP
      const zip = new JSZip();
      let totalOriginalSize = 0;
      let totalCompressedSize = 0;

      for (let i = 0; i < images.length; i++) {
        const file = images[i];
        totalOriginalSize += file.size;
        
        const buffer = Buffer.from(await file.arrayBuffer());
        const compressedBuffer = await sharp(buffer)
          .jpeg({ quality, mozjpeg: true })
          .png({ quality: quality - 10, palette: true })
          .webp({ quality })
          .toBuffer();
          
        totalCompressedSize += compressedBuffer.length;
        zip.file(file.name, compressedBuffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      // Log Conversion
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await Conversion.create({
        userId,
        toolUsed: 'Compress Image (Batch)',
        fileName: 'compressed_images.zip',
        fileSize: totalOriginalSize,
        status: 'success',
        metadata: { pages: images.length, processedSize: zipBuffer.length },
        expiresAt
      });

      return new NextResponse(zipBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="compressed_images.zip"`,
        },
      });
    }

  } catch (error) {
    console.error('[API/Convert/Image-Compress] Error:', error);
    return NextResponse.json({ error: 'Failed to compress images' }, { status: 500 });
  }
}
