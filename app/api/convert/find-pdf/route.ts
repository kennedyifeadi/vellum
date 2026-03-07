import { NextRequest, NextResponse } from 'next/server';
import { findTextInPdf } from '@/lib/pdf/find';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('pdf') as File;
    const searchText = formData.get('searchText') as string;

    if (!file || !searchText) {
      return NextResponse.json({ error: 'PDF file and search text are required.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    const searchResults = await findTextInPdf({
      pdfBuffer,
      searchText,
    });

    return NextResponse.json({ results: searchResults }, { status: 200 });
  } catch (error) {
    console.error('Error finding text in PDF:', error);
    return NextResponse.json({ error: 'Failed to find text in PDF.' }, { status: 500 });
  }
}