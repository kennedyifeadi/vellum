import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import JSZip from 'jszip';

let mockResolvedFiles: File[] = [];
let mockFailSuccessResponses = false;

// The routes' own NextResponse, made unable to build a successful response on demand:
// the state an unencodable header once put them in after the work was done.
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  const cannotBuild = (init?: ResponseInit) => mockFailSuccessResponses && (init?.status ?? 200) < 400;
  class UnbuildableResponse extends actual.NextResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      if (cannotBuild(init)) throw new TypeError('Cannot convert argument to a ByteString');
      super(body, init);
    }

    static json(body: unknown, init?: ResponseInit) {
      if (cannotBuild(init)) throw new TypeError('Cannot convert argument to a ByteString');
      return actual.NextResponse.json(body, init);
    }
  }
  return { ...actual, NextResponse: UnbuildableResponse };
});

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011'),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findById: jest.fn().mockResolvedValue({ plan: 'Pro' }) },
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn().mockResolvedValue(true),
  recordConversionHistory: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('@/lib/html/to-pdf', () => ({
  convertHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 html')),
}));

jest.mock('@/lib/doc/to-pdf', () => ({
  convertDocxToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 docx')),
}));

jest.mock('@/lib/video/compress', () => ({
  compressVideo: jest.fn().mockResolvedValue({
    bytes: Buffer.from('encoded video'),
    compressed: true,
    format: { extension: 'mp4', contentType: 'video/mp4' },
  }),
}));

import { recordConversionHistory, saveConversionRecord } from '@/lib/conversions';
import { POST as compressPdf } from '../app/api/convert/compress-pdf/route';
import { POST as mergePdf } from '../app/api/convert/merge-pdf/route';
import { POST as splitPdf } from '../app/api/convert/split-pdf/route';
import { POST as lockPdf } from '../app/api/convert/lock-pdf/route';
import { POST as findPdf } from '../app/api/convert/find-pdf/route';
import { POST as pdfToDocx } from '../app/api/convert/pdf-to-docx/route';
import { POST as htmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { POST as docxToPdf } from '../app/api/convert/docx-to-pdf/route';
import { POST as imageToPdf } from '../app/api/convert/image-to-pdf/route';
import { POST as imageCompress } from '../app/api/convert/image-compress/route';
import { POST as jpgToPng } from '../app/api/convert/jpg-to-png/route';
import { POST as videoCompress } from '../app/api/convert/video-compress/route';

jest.setTimeout(60_000);

async function pdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]).drawText('hello', { x: 20, y: 100, font, size: 12 });
  return Buffer.from(await doc.save());
}

async function docx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

const jpeg = () => sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();

const file = (bytes: Buffer, name: string, type: string) => new File([bytes as BlobPart], name, { type });

function post(path: string, fields: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest(`http://localhost:3000${path}`, { method: 'POST', body: form });
}

const ROUTES: [string, () => Promise<File[]>, () => Promise<Response>][] = [
  ['compress-pdf', async () => [file(await pdf(), 'a.pdf', 'application/pdf')], () => compressPdf(post('/api/convert/compress-pdf'))],
  ['merge-pdf', async () => [file(await pdf(), 'a.pdf', 'application/pdf'), file(await pdf(), 'b.pdf', 'application/pdf')], () => mergePdf(post('/api/convert/merge-pdf'))],
  ['split-pdf to one PDF', async () => [file(await pdf(2), 'a.pdf', 'application/pdf')], () => splitPdf(post('/api/convert/split-pdf', { startPage: '1', endPage: '1' }))],
  ['split-pdf to a zip', async () => [file(await pdf(2), 'a.pdf', 'application/pdf')], () => splitPdf(post('/api/convert/split-pdf', { startPage: '1', endPage: '2', splitEvery: 'true' }))],
  ['lock-pdf', async () => [file(await pdf(), 'a.pdf', 'application/pdf')], () => lockPdf(post('/api/convert/lock-pdf', { password: 'secret-1' }))],
  ['find-pdf', async () => [file(await pdf(), 'a.pdf', 'application/pdf')], () => findPdf(post('/api/convert/find-pdf', { searchTerm: 'hello' }))],
  ['pdf-to-docx', async () => [file(await pdf(), 'a.pdf', 'application/pdf')], () => pdfToDocx(post('/api/convert/pdf-to-docx'))],
  ['html-to-pdf', async () => [file(Buffer.from('<p>hi</p>'), 'a.html', 'text/html')], () => htmlToPdf(post('/api/convert/html-to-pdf'))],
  ['docx-to-pdf', async () => [file(await docx(), 'a.docx', 'application/octet-stream')], () => docxToPdf(post('/api/convert/docx-to-pdf'))],
  ['image-to-pdf', async () => [file(await jpeg(), 'a.jpg', 'image/jpeg')], () => imageToPdf(post('/api/convert/image-to-pdf'))],
  ['image-compress', async () => [file(await jpeg(), 'a.jpg', 'image/jpeg')], () => imageCompress(post('/api/convert/image-compress'))],
  ['jpg-to-png', async () => [file(await jpeg(), 'a.jpg', 'image/jpeg')], () => jpgToPng(post('/api/convert/jpg-to-png'))],
  ['video-compress', async () => [file(Buffer.from('video'), 'a.mp4', 'video/mp4')], () => videoCompress(post('/api/convert/video-compress'))],
];

function historyWrites(): number {
  return jest.mocked(saveConversionRecord).mock.calls.length + jest.mocked(recordConversionHistory).mock.calls.length;
}

/** The route's answer, or a 500 for a rejection, which is what Next sends for one. */
async function answer(call: () => Promise<Response>): Promise<number> {
  return call().then(
    (res) => res.status,
    () => 500,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFailSuccessResponses = false;
});

describe.each(ROUTES)('%s history', (_route, inputs, call) => {
  it('records a conversion whose response was built', async () => {
    mockResolvedFiles = await inputs();

    expect(await answer(call)).toBe(200);
    expect(historyWrites()).toBe(1);
  });

  it('records nothing when the response cannot be built', async () => {
    mockResolvedFiles = await inputs();
    mockFailSuccessResponses = true;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await answer(call)).toBe(500);
    expect(historyWrites()).toBe(0);
  });
});

describe('html-to-pdf URL mode history', () => {
  const urlRequest = () =>
    htmlToPdf(
      new NextRequest('http://localhost:3000/api/convert/html-to-pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/' }),
      }),
    );

  it('records nothing when the response cannot be built', async () => {
    mockFailSuccessResponses = true;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await answer(urlRequest)).toBe(500);
    expect(historyWrites()).toBe(0);
  });
});
