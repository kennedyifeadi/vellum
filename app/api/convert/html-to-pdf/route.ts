import { NextRequest, NextResponse } from 'next/server';
import { convertHtmlToPdf } from '@/lib/html/to-pdf';
import { getAuthUserId } from '@/lib/auth/jwt';
import { saveConversionRecord } from '@/lib/conversions';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import User from '@/models/user';
import dbConnect from '@/lib/db/mongoose';

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthUserId(req);
    let plan = 'Free';
    if (userId) {
      await dbConnect();
      const user = await User.findById(userId);
      plan = user?.plan || 'Free';
    }

    const maxSize = resolvePlanLimit(plan, {
      guest: 25 * 1024 * 1024,
      Basic: 50 * 1024 * 1024,
      Pro: 100 * 1024 * 1024,
      Enterprise: 500 * 1024 * 1024,
    });

    let htmlContent: string | undefined;
    let url: string | undefined;
    let outputFileName = 'converted.pdf';

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // File upload mode
      const formData = await req.formData();
      const file = (await resolveFiles(formData, 'html'))[0] as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No HTML file provided.' }, { status: 400 });
      }
      if (file.size > maxSize) {
        throw new ClientError(
          `Your current plan allows HTML files up to ${maxSize / (1024 * 1024)}MB.`,
        );
      }
      htmlContent = await file.text();
      outputFileName = file.name.replace(/\.html?$/i, '.pdf');
    } else {
      // URL mode
      const body = await req.json();
      url = body.url;
      if (!url) {
        return NextResponse.json({ error: 'No URL provided.' }, { status: 400 });
      }
      try {
        const hostname = new URL(url).hostname;
        outputFileName = `${hostname}.pdf`;
      } catch {
        outputFileName = 'webpage.pdf';
      }
    }

    const pdfBuffer = await convertHtmlToPdf({ htmlContent, url });

    if (userId) {
      try {
        await saveConversionRecord(userId, 'HTML to PDF', outputFileName, Buffer.from(pdfBuffer));
      } catch (recordError) {
        console.error('Failed to record HTML to PDF conversion:', recordError);
      }
    }

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${outputFileName}"`,
      },
    });
  } catch (error) {
    return handleConvertError(error, 'Failed to convert HTML to PDF.');
  }
}
