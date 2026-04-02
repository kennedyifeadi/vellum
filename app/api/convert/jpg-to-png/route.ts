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

    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    await dbConnect();
    const user = await User.findById(userId);
    
    // Check Limits
    const MAX_FREE_FILES = 5;
    const MAX_PRO_FILES = 10;
    const maxAllowed = user?.plan === 'Pro' ? MAX_PRO_FILES : MAX_FREE_FILES;

    if (images.length > maxAllowed) {
      return NextResponse.json({ 
        error: `Your current plan allows up to ${maxAllowed} images per conversion.` 
      }, { status: 400 });
    }

    // Process multiple images vs single image
    if (images.length === 1) {
      const file = images[0];
      const buffer = Buffer.from(await file.arrayBuffer());
      
      const pngBuffer = await sharp(buffer)
        .png({ quality: 100 })
        .toBuffer();

      // Log Conversion
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // Expires in 2 hours
      await Conversion.create({
        userId,
        toolUsed: 'JPEG to PNG',
        fileName: file.name,
        fileSize: file.size,
        status: 'success',
        metadata: { pages: 1, processedSize: pngBuffer.length },
        expiresAt
      });

      return new NextResponse(pngBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="converted_${file.name.replace(/\.[^/.]+$/, "")}.png"`,
        },
      });
    } else {
      // Multiple Images - Create ZIP
      const zip = new JSZip();
      let totalOriginalSize = 0;

      for (let i = 0; i < images.length; i++) {
        const file = images[i];
        totalOriginalSize += file.size;
        
        const buffer = Buffer.from(await file.arrayBuffer());
        const pngBuffer = await sharp(buffer)
          .png({ quality: 100 })
          .toBuffer();
          
        // Ensure unique names and correct extensions inside ZIP
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        zip.file(`${baseName}.png`, pngBuffer);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      // Log Conversion
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // Expires in 2 hours
      await Conversion.create({
        userId,
        toolUsed: 'JPEG to PNG (Batch)',
        fileName: 'converted_images.zip',
        fileSize: totalOriginalSize,
        status: 'success',
        metadata: { pages: images.length, processedSize: zipBuffer.length },
        expiresAt
      });

      return new NextResponse(zipBuffer as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="converted_images.zip"`,
        },
      });
    }

  } catch (error) {
    console.error('[API/Convert/JPG-to-PNG] Error:', error);
    return NextResponse.json({ error: 'Failed to convert images to PNG' }, { status: 500 });
  }
}
