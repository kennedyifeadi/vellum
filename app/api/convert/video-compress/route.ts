import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import path from 'path';
import fs from 'fs';
import { tmpdir } from 'os';

// Setup ffmpeg path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const video = formData.get('video') as File;
    const quality = formData.get('quality') as string || 'Medium';
    const resolution = formData.get('resolution') as string || 'Original';

    if (!video) {
      return NextResponse.json({ error: 'No video provided' }, { status: 400 });
    }

    await dbConnect();
    const user = await User.findById(userId);
    
    // Check Limits
    const MAX_FREE_SIZE = 100 * 1024 * 1024;
    const MAX_PRO_SIZE = 500 * 1024 * 1024;
    const maxSize = user?.plan === 'Pro' ? MAX_PRO_SIZE : MAX_FREE_SIZE;

    if (video.size > maxSize) {
      return NextResponse.json({ 
        error: `Your current plan allows videos up to ${maxSize / (1024 * 1024)}MB.` 
      }, { status: 400 });
    }

    // Save uploaded file to temp dir
    const tempDir = tmpdir();
    const inputPath = path.join(tempDir, `input-${Date.now()}-${video.name}`);
    const outputPath = path.join(tempDir, `output-${Date.now()}-compressed.mp4`);

    const arrayBuffer = await video.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(inputPath, buffer);

    // Map quality to Constant Rate Factor (CRF)
    // Lower CRF = better quality, larger size.
    let crf = 28;
    if (quality === 'High') crf = 23;      // High quality, less compression
    else if (quality === 'Medium') crf = 28; // Balanced
    else if (quality === 'Low') crf = 32;    // Low quality, high compression

    // Process video
    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .outputOptions(['-crf', String(crf)]);
      
      // If resolution is not 'Original', resize it
      if (resolution === '720p') {
        command = command.size('?x720');
      } else if (resolution === '480p') {
        command = command.size('?x480');
      }

      command
        .on('end', () => resolve())
        .on('error', (err) => {
          console.error('FFmpeg Error:', err);
          reject(err);
        })
        .save(outputPath);
    });

    const compressedBuffer = fs.readFileSync(outputPath);

    // Clean up temp files
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (e) {
      console.error('Failed to cleanup temp files:', e);
    }

    // Log Conversion
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await Conversion.create({
      userId,
      toolUsed: 'Compress Video',
      fileName: video.name,
      fileSize: video.size,
      status: 'success',
      metadata: { pages: 1, processedSize: compressedBuffer.length },
      expiresAt
    });

    return new NextResponse(compressedBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="compressed_${video.name.replace(/\.[^/.]+$/, "")}.mp4"`,
      },
    });

  } catch (error) {
    console.error('[API/Convert/Video-Compress] Error:', error);
    return NextResponse.json({ error: 'Failed to compress video' }, { status: 500 });
  }
}
