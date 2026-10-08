import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import dbConnect from '@/lib/db/mongoose';

const MB = 1024 * 1024;
const USER_ID = '507f1f77bcf86cd799439011';

let mockUserId: string | null = null;
let mockPlan: string | undefined = 'Free';
let mockResolvedFiles: unknown[] = [];

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

const recordConversionHistory = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  recordConversionHistory: (...args: unknown[]) => recordConversionHistory(...args),
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const mockExtractPdfTextItems = jest
  .fn()
  .mockResolvedValue([[{ str: 'Find me', hasEOL: false, width: 60, height: 18, transform: [18, 0, 0, 18, 20, 150] }]]);
jest.mock('@/lib/convert/find-pdf-extraction', () => ({
  extractPdfTextItems: (...args: unknown[]) => mockExtractPdfTextItems(...args),
}));

import { POST as handleFindPdf } from '../app/api/convert/find-pdf/route';

let pdf: Buffer;

/**
 * The size gate reads only the upload's reported size, so a small PDF reporting a
 * large size stands in for a multi-megabyte fixture. `arrayBuffer` is a spy so a test
 * can assert the upload was never read.
 */
function pdfFile(reportedSize = pdf.length, name = 'report.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: reportedSize,
    arrayBuffer: jest.fn().mockResolvedValue(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength)),
  };
}

function find(file: ReturnType<typeof pdfFile>) {
  mockResolvedFiles = [file];
  const formData = new FormData();
  formData.append('searchTerm', 'find me');
  return handleFindPdf(
    new NextRequest('http://localhost:3000/api/convert/find-pdf', { method: 'POST', body: formData }),
  );
}

function signIn(plan: string | undefined) {
  mockUserId = USER_ID;
  mockPlan = plan;
}

beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText('Find me', { x: 20, y: 150, font, size: 18 });
  pdf = Buffer.from(await doc.save());
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  (dbConnect as jest.Mock).mockResolvedValue(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('find-pdf per-plan upload size limit', () => {
  it('refuses an over-cap guest upload without reading or extracting it', async () => {
    const file = pdfFile(60 * MB);

    const res = await find(file);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Your current plan allows PDFs up to 25MB.' });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(mockExtractPdfTextItems).not.toHaveBeenCalled();
  });

  it.each([
    ['a guest', null, 25],
    ['a signed-in user with no plan', undefined, 25],
    ['a signed-in user with an unrecognised plan', 'Platinum', 25],
    ['Basic', 'Basic', 50],
    ['Pro', 'Pro', 100],
    ['Enterprise', 'Enterprise', 500],
  ])('holds %s to its own cap', async (_label, plan, capMb) => {
    if (plan !== null) signIn(plan);
    const overCap = pdfFile(capMb * MB + 1);

    const accepted = await find(pdfFile(capMb * MB));
    const refused = await find(overCap);

    expect(accepted.status).toBe(200);
    expect((await accepted.json()).matchCount).toBe(1);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: `Your current plan allows PDFs up to ${capMb}MB.` });
    expect(overCap.arrayBuffer).not.toHaveBeenCalled();
    expect(mockExtractPdfTextItems).toHaveBeenCalledTimes(1);
  });

  it('refuses an over-cap upload from a signed-in user without recording it', async () => {
    signIn('Basic');

    const res = await find(pdfFile(51 * MB));

    expect(res.status).toBe(400);
    expect(mockExtractPdfTextItems).not.toHaveBeenCalled();
    expect(recordConversionHistory).not.toHaveBeenCalled();
  });
});

describe('find-pdf database use', () => {
  it('searches for a guest without connecting to the database', async () => {
    const res = await find(pdfFile());

    expect(res.status).toBe(200);
    expect(dbConnect).not.toHaveBeenCalled();
  });

  it('searches for a guest while the database is down', async () => {
    (dbConnect as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await find(pdfFile());

    expect(res.status).toBe(200);
  });

  it('searches and records history for a signed-in user', async () => {
    signIn('Pro');

    const res = await find(pdfFile());

    expect(res.status).toBe(200);
    expect((await res.json()).matchCount).toBe(1);
    expect(dbConnect).toHaveBeenCalled();
    expect(recordConversionHistory).toHaveBeenCalledTimes(1);
    expect(recordConversionHistory).toHaveBeenCalledWith(USER_ID, 'Find in PDF', 'report.pdf', pdf.length, {
      pages: 1,
      matchesFound: 1,
      searchTerm: 'find me',
    });
  });
});
