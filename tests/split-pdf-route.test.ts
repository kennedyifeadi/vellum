import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PDFDocument as EncryptablePDFDocument } from 'pdf-lib-plus-encrypt';

let mockUserId: string | null = null;
let mockPlan = 'Free';
let mockResolvedFiles: any[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockUserId ? { plan: mockPlan } : null)),
  },
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const saveConversionRecord = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: (...args: any[]) => saveConversionRecord(...args),
}));

jest.mock('@/lib/pdf/split', () => ({
  splitPdf: jest.fn((opts: any) => jest.requireActual('@/lib/pdf/split').splitPdf(opts)),
}));

import { POST as handleSplitPdf } from '../app/api/convert/split-pdf/route';
import { splitPdf } from '@/lib/pdf/split';

const splitPdfMock = splitPdf as jest.Mock;

async function createPdf(pageCount = 3): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]).drawText(`Page ${i + 1}`, { x: 20, y: 100, font, size: 14 });
  }
  return Buffer.from(await doc.save());
}

async function createEncryptedPdf(): Promise<Buffer> {
  const doc = await EncryptablePDFDocument.load(await createPdf(2));
  await doc.encrypt({ userPassword: 'secret', ownerPassword: 'secret' });
  return Buffer.from(await doc.save());
}

function fakeFile(buffer: Buffer, name = 'doc.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function splitRequest(fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    body.append(key, value);
  }
  return new NextRequest('http://localhost:3000/api/convert/split-pdf', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  splitPdfMock.mockImplementation((opts: any) =>
    jest.requireActual('@/lib/pdf/split').splitPdf(opts)
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('split-pdf route error handling', () => {
  it('splits a valid PDF: 200, pdf body', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(3))];

    const res = await handleSplitPdf(splitRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns the split output byte-for-byte unchanged', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(3))];
    const expected = Buffer.from('%PDF-1.7 stub split output');
    splitPdfMock.mockResolvedValueOnce(new Map([['split_document_pages_1_to_1.pdf', expected]]));

    const res = await handleSplitPdf(splitRequest());

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(expected)).toBe(true);
  });

  it('returns 400, not 500, for a 0-byte file', async () => {
    mockResolvedFiles = [fakeFile(Buffer.alloc(0))];

    const res = await handleSplitPdf(splitRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it('returns 400, not 500, for non-PDF input', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('<html>not a pdf</html>'), 'page.html')];

    const res = await handleSplitPdf(splitRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a valid PDF or is corrupted/i);
  });

  it('returns 400, not 500, for a corrupted/truncated PDF', async () => {
    mockResolvedFiles = [fakeFile((await createPdf(3)).subarray(0, 90))];

    const res = await handleSplitPdf(splitRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a valid PDF or is corrupted/i);
  });

  it('returns 400 with the actionable message for an encrypted PDF', async () => {
    mockResolvedFiles = [fakeFile(await createEncryptedPdf())];

    const res = await handleSplitPdf(splitRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'This PDF is password-protected. Please remove the password before splitting it.'
    );
  });

  it('returns 400, not 500, for a page range outside the document', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(3))];

    const res = await handleSplitPdf(splitRequest({ startPage: '50', endPage: '60' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/outside this 3-page document/i);
  });

  it('still returns 500 for a genuine server fault', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(2))];
    splitPdfMock.mockRejectedValueOnce(new Error('pdf-lib internal invariant'));

    const res = await handleSplitPdf(splitRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to split PDF.');
  });

  it('does not turn a saveConversionRecord failure into a 500', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockResolvedFiles = [fakeFile(await createPdf(2))];
    saveConversionRecord.mockRejectedValueOnce(new Error('mongo write timeout'));

    const res = await handleSplitPdf(splitRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(saveConversionRecord).toHaveBeenCalledTimes(1);
  });
});
