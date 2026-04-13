import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserId } from '@/lib/auth/jwt';
import User from '@/models/user';
import Conversion from '@/models/conversion';
import dbConnect from '@/lib/db/mongoose';
import { PDFParse } from 'pdf-parse';
import { Document, Packer, Paragraph, TextRun } from 'docx';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('pdf') as File;

    if (!file) {
      return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });
    }

    await dbConnect();
    const user = await User.findById(userId);
    
    // Check Limits
    const MAX_FREE_SIZE = 50 * 1024 * 1024;
    const MAX_PRO_SIZE = 100 * 1024 * 1024;
    const maxSize = user?.plan === 'Pro' ? MAX_PRO_SIZE : MAX_FREE_SIZE;

    if (file.size > maxSize) {
      return NextResponse.json({ 
        error: `Your current plan allows PDFs up to ${maxSize / (1024 * 1024)}MB.` 
      }, { status: 400 });
    }

    // 1. Extract Text
    const arrayBuffer = await file.arrayBuffer();
    const pdfParser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
    const data = await pdfParser.getText();
    const numPages = data.total;
    await pdfParser.destroy();
    
    // 2. Generate DOCX
    // pdf-parse provides extracted text separated by newlines
    const doc = new Document({
      sections: [{
        properties: {},
        children: data.text.split('\n').map(line => 
          new Paragraph({
            children: [new TextRun(line)],
          })
        ),
      }],
    });

    const docxBuffer = await Packer.toBuffer(doc);

    // Log Conversion
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // Expires in 2 hours
    await Conversion.create({
      userId,
      toolUsed: 'PDF to DOCX',
      fileName: file.name,
      fileSize: file.size,
      status: 'success',
      metadata: { pages: numPages, processedSize: docxBuffer.length },
      expiresAt
    });

    return new NextResponse(docxBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${file.name.replace(/\.[^/.]+$/, "")}.docx"`,
      },
    });

  } catch (error) {
    console.error('[API/Convert/PDF-to-DOCX] Error:', error);
    return NextResponse.json({ error: 'Failed to convert PDF to DOCX' }, { status: 500 });
  }
}
