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

jest.mock('@/lib/pdf/merge', () => ({
  mergePdfs: jest.fn((opts: any) => jest.requireActual('@/lib/pdf/merge').mergePdfs(opts)),
}));

import { POST as handleMergePdf } from '../app/api/convert/merge-pdf/route';
import { mergePdfs } from '@/lib/pdf/merge';

const mergePdfsMock = mergePdfs as jest.Mock;

async function createPdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    doc.addPage([200, 200]).drawText(`p${i}`, { x: 10, y: 100, font, size: 12 });
  }
  return Buffer.from(await doc.save());
}

async function createEncryptedPdf(): Promise<Buffer> {
  const doc = await EncryptablePDFDocument.load(await createPdf(1));
  await doc.encrypt({ userPassword: 'secret', ownerPassword: 'secret' });
  return Buffer.from(await doc.save());
}

function fakeFile(buffer: Buffer, name = 'part.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function mergeRequest() {
  return new NextRequest('http://localhost:3000/api/convert/merge-pdf', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  mergePdfsMock.mockImplementation((opts: any) =>
    jest.requireActual('@/lib/pdf/merge').mergePdfs(opts)
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('merge-pdf route error handling', () => {
  it('merges two valid PDFs unchanged: 200, pdf body', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(2)), fakeFile(await createPdf(1))];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns 400, not 500, when one input is a 0-byte file', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(1)), fakeFile(Buffer.alloc(0))];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/file 2 is empty/i);
  });

  it('returns 400, not 500, when one input is not a PDF', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(1)), fakeFile(Buffer.from('not a pdf'), 'x.txt')];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/file 2 is not a valid PDF or is corrupted/i);
  });

  it('returns 400, not 500, when one input is a truncated PDF', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(1)), fakeFile((await createPdf(3)).subarray(0, 80))];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/file 2 is not a valid PDF or is corrupted/i);
  });

  it('returns 400 with the actionable message for an encrypted input', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(1)), fakeFile(await createEncryptedPdf())];

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'File 2 is password-protected. Please remove the password before merging it.'
    );
  });

  it('still returns 500 for a genuine server fault', async () => {
    mockResolvedFiles = [fakeFile(await createPdf(1)), fakeFile(await createPdf(1))];
    mergePdfsMock.mockRejectedValueOnce(new Error('out of memory'));

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to merge PDFs.');
  });

  it('does not turn a saveConversionRecord failure into a 500', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockPlan = 'Pro';
    mockResolvedFiles = [fakeFile(await createPdf(2)), fakeFile(await createPdf(1))];
    saveConversionRecord.mockRejectedValueOnce(new Error('mongo down'));

    const res = await handleMergePdf(mergeRequest());

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(saveConversionRecord).toHaveBeenCalledTimes(1);
  });
});
