import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDFDocument as EncryptablePDFDocument } from 'pdf-lib-plus-encrypt';

let mockUserId: string | null = null;
let mockResolvedFiles: any[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const saveConversionRecord = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: (...args: any[]) => saveConversionRecord(...args),
}));

jest.mock('@/lib/pdf/compress', () => ({
  compressPdf: jest.fn((opts: any) => jest.requireActual('@/lib/pdf/compress').compressPdf(opts)),
}));

import { POST as handleCompressPdf } from '../app/api/convert/compress-pdf/route';
import { compressPdf } from '@/lib/pdf/compress';

const compressPdfMock = compressPdf as jest.Mock;

async function createPdf(pageCount = 2): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]).drawText(`Page ${i + 1}`, { x: 20, y: 100, font, size: 14 });
  }
  return Buffer.from(await doc.save());
}

async function createEncryptedPdf(): Promise<Buffer> {
  const doc = await EncryptablePDFDocument.load(await createPdf(1));
  await doc.encrypt({ userPassword: 'secret', ownerPassword: 'secret' });
  return Buffer.from(await doc.save());
}

function fakeFile(buffer: Buffer, name = 'doc.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: buffer.length,
    arrayBuffer: jest.fn().mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function compressRequest() {
  return new NextRequest('http://localhost:3000/api/convert/compress-pdf', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockResolvedFiles = [];
  compressPdfMock.mockImplementation((opts: any) =>
    jest.requireActual('@/lib/pdf/compress').compressPdf(opts)
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('compress-pdf route error handling', () => {
  it('compresses a valid PDF unchanged: 200, pdf body, size headers', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(3))];

    const res = await handleCompressPdf(compressRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-Original-Size')).toBeTruthy();
    expect(res.headers.get('X-Compressed-Size')).toBeTruthy();
    expect(res.headers.get('Content-Disposition')).toContain('compressed_doc.pdf');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns 400, not 500, for a 0-byte file', async () => {
    mockResolvedFiles = [fakeFile(Buffer.alloc(0))];

    const res = await handleCompressPdf(compressRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it('returns 400, not 500, for non-PDF input', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('<html>not a pdf</html>'), 'page.html')];

    const res = await handleCompressPdf(compressRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a valid PDF or is corrupted/i);
  });

  it('returns 400, not 500, for a corrupted/truncated PDF', async () => {
    mockResolvedFiles = [fakeFile((await createPdf(3)).subarray(0, 90))];

    const res = await handleCompressPdf(compressRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a valid PDF or is corrupted/i);
  });

  it('returns 400 with the actionable message for an encrypted PDF', async () => {
    mockResolvedFiles = [fakeFile(await createEncryptedPdf())];

    const res = await handleCompressPdf(compressRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'This PDF is password-protected. Please remove the password before compressing it.'
    );
  });

  it('still returns 500 for a genuine server fault', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(2))];
    compressPdfMock.mockRejectedValueOnce(new Error('sharp: worker pool crashed'));

    const res = await handleCompressPdf(compressRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to compress PDF.');
  });

  it('does not turn a saveConversionRecord failure into a 500', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockResolvedFiles = [fakeFile(await createPdf(2))];
    saveConversionRecord.mockRejectedValueOnce(new Error('mongo write timeout'));

    const res = await handleCompressPdf(compressRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(saveConversionRecord).toHaveBeenCalledTimes(1);
  });
});
