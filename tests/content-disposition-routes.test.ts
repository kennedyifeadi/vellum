import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

const OWNER_ID = '507f1f77bcf86cd799439011';

let mockResolvedFiles: File[] = [];
const mockConversionCreate = jest.fn().mockResolvedValue(true);
let mockConversionRecord: Record<string, unknown> | null = null;
let mockDocument: Record<string, unknown> | null = null;

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011'),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findById: jest.fn().mockResolvedValue({ plan: 'Pro', preferences: {} }) },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: {
    create: (...args: unknown[]) => mockConversionCreate(...args),
    findOne: jest.fn(() => Promise.resolve(mockConversionRecord)),
    find: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: { findOne: jest.fn(() => Promise.resolve(mockDocument)) },
}));

jest.mock('@/lib/storage', () => ({
  getStorage: () => ({
    put: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(Buffer.from('stored bytes')),
  }),
  LocalDiskStorage: class {},
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

import JSZip from 'jszip';
import { POST as compressPdf } from '../app/api/convert/compress-pdf/route';
import { POST as pdfToDocx } from '../app/api/convert/pdf-to-docx/route';
import { POST as htmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { POST as docxToPdf } from '../app/api/convert/docx-to-pdf/route';
import { POST as imageCompress } from '../app/api/convert/image-compress/route';
import { POST as jpgToPng } from '../app/api/convert/jpg-to-png/route';
import { POST as videoCompress } from '../app/api/convert/video-compress/route';
import { GET as downloadConversion } from '../app/api/download/[id]/route';
import { GET as downloadDocument } from '../app/api/documents/download/[id]/route';

jest.setTimeout(60_000);

// The classes of name #76 found breaking the header or arriving corrupted.
const NAMES: [string, string][] = [
  ['plain ASCII', 'report'],
  ['accents', 'résumé café'],
  ['CJK', '季度报告'],
  ['emoji', 'holiday 😀🎉'],
  ['a double quote', 'a".pdf"; filename*=UTF-8\'\'evil.exe; x="'],
  ['a backslash', 'C:\\temp\\report'],
  ['CR/LF', 'line\r\nSet-Cookie: injected=1'],
  ['NUL', 'nul\u0000byte'],
  ['a very long name', `${'长'.repeat(400)}x`],
  ['an empty name', ''],
];

// RFC 6266: an ASCII quoted fallback with nothing to escape, then the RFC 5987 value.
const DISPOSITION_GRAMMAR = /^attachment; filename="[\x20\x21\x23-\x5b\x5d-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9!#$&+\-.^_`|~%]+$/;

function visibleName(disposition: string): string {
  const [, encoded] = disposition.match(/; filename\*=UTF-8''([^;"]+)$/)!;
  return decodeURIComponent(encoded);
}

/** The part of `name` that must survive into the downloaded name: no control characters. */
function survivingPart(name: string): string {
  return name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 40);
}

function expectSafeDisposition(res: Response, uploadStem: string) {
  expect(res.status).toBe(200);
  const disposition = res.headers.get('content-disposition')!;
  expect(disposition).toMatch(DISPOSITION_GRAMMAR);

  const name = visibleName(disposition);
  expect(Array.from(name).length).toBeLessThanOrEqual(200);
  expect(name).not.toMatch(/[\x00-\x1f\x7f]/);
  expect(name).toContain(survivingPart(uploadStem));
}

async function tinyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([200, 200]).drawText('Hello', { x: 20, y: 100, font, size: 12 });
  return Buffer.from(await doc.save());
}

async function tinyDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

const tinyJpeg = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 10, b: 10 } } }).jpeg().toBuffer();

function upload(bytes: Buffer, name: string, type: string): File {
  return new File([bytes as BlobPart], name, { type });
}

function post(path: string, fields: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest(`http://localhost:3000${path}`, { method: 'POST', body: form });
}

interface UploadTool {
  route: string;
  extension: string;
  type: string;
  bytes: () => Promise<Buffer>;
  call: () => Promise<Response>;
}

const TOOLS: UploadTool[] = [
  { route: 'compress-pdf', extension: '.pdf', type: 'application/pdf', bytes: tinyPdf, call: () => compressPdf(post('/api/convert/compress-pdf')) },
  { route: 'pdf-to-docx', extension: '.pdf', type: 'application/pdf', bytes: tinyPdf, call: () => pdfToDocx(post('/api/convert/pdf-to-docx')) },
  { route: 'html-to-pdf', extension: '.html', type: 'text/html', bytes: async () => Buffer.from('<p>hi</p>'), call: () => htmlToPdf(post('/api/convert/html-to-pdf')) },
  { route: 'docx-to-pdf', extension: '.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: tinyDocx, call: () => docxToPdf(post('/api/convert/docx-to-pdf')) },
  { route: 'image-compress', extension: '.jpg', type: 'image/jpeg', bytes: tinyJpeg, call: () => imageCompress(post('/api/convert/image-compress')) },
  { route: 'jpg-to-png', extension: '.jpg', type: 'image/jpeg', bytes: tinyJpeg, call: () => jpgToPng(post('/api/convert/jpg-to-png')) },
  { route: 'video-compress', extension: '.mp4', type: 'video/mp4', bytes: async () => Buffer.from('video bytes'), call: () => videoCompress(post('/api/convert/video-compress')) },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockResolvedFiles = [];
});

describe.each(TOOLS)('$route Content-Disposition', (tool) => {
  it.each(NAMES)('names the download safely for %s', async (_label, stem) => {
    mockResolvedFiles = [upload(await tool.bytes(), `${stem}${tool.extension}`, tool.type)];

    const res = await tool.call();

    expectSafeDisposition(res, stem);
  });
});

describe.each([
  [
    'download/[id]',
    (fileName: string) => {
      mockConversionRecord = { userId: OWNER_ID, diskFileName: 'f00d.pdf', fileName };
      return downloadConversion(new NextRequest('http://localhost:3000/api/download/f00d'), {
        params: Promise.resolve({ id: 'f00d' }),
      });
    },
  ],
  [
    'documents/download/[id]',
    (fileName: string) => {
      mockDocument = { _id: 'doc1', diskFileName: 'abc.pdf', fileName, mimeType: 'application/pdf' };
      return downloadDocument(new NextRequest('http://localhost:3000/api/documents/download/doc1'), {
        params: Promise.resolve({ id: 'doc1' }),
      });
    },
  ],
])('%s Content-Disposition', (_route, download) => {
  it.each(NAMES)('names the download safely for %s', async (_label, stem) => {
    const res = await download(`${stem}.pdf`);

    expectSafeDisposition(res, stem);
  });

  it('falls back to a generic name when the stored name is empty', async () => {
    const res = await download('');

    expect(res.status).toBe(200);
    expect(visibleName(res.headers.get('content-disposition')!)).toBe('download');
  });
});
