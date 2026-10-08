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

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const saveConversionRecord = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: (...args: unknown[]) => saveConversionRecord(...args),
}));

jest.mock('@/lib/pdf/lock', () => {
  const actual = jest.requireActual('@/lib/pdf/lock');
  return { ...actual, lockPdf: jest.fn(actual.lockPdf) };
});

import { POST as handleLockPdf } from '../app/api/convert/lock-pdf/route';
import { lockPdf } from '@/lib/pdf/lock';

let pdf: Buffer;

/**
 * The size gate reads only the upload's reported size, so a small PDF reporting a
 * large size stands in for a multi-megabyte fixture. `arrayBuffer` is a spy so a test
 * can assert the upload was never read.
 */
function pdfFile(reportedSize = pdf.length, name = 'contract.pdf') {
  return {
    name,
    type: 'application/pdf',
    size: reportedSize,
    arrayBuffer: jest.fn().mockResolvedValue(pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength)),
  };
}

function lock(file: ReturnType<typeof pdfFile>) {
  mockResolvedFiles = [file];
  const formData = new FormData();
  formData.append('password', 'correct horse');
  return handleLockPdf(
    new NextRequest('http://localhost:3000/api/convert/lock-pdf', { method: 'POST', body: formData }),
  );
}

function signIn(plan: string | undefined) {
  mockUserId = USER_ID;
  mockPlan = plan;
}

beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText('Lock me', { x: 20, y: 150, font, size: 18 });
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

describe('lock-pdf per-plan upload size limit', () => {
  it('refuses an over-cap guest upload without reading or locking it', async () => {
    const file = pdfFile(60 * MB);

    const res = await lock(file);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Your current plan allows PDFs up to 25MB.' });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(lockPdf).not.toHaveBeenCalled();
    expect(saveConversionRecord).not.toHaveBeenCalled();
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

    const accepted = await lock(pdfFile(capMb * MB));
    const refused = await lock(overCap);

    expect(accepted.status).toBe(200);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: `Your current plan allows PDFs up to ${capMb}MB.` });
    expect(overCap.arrayBuffer).not.toHaveBeenCalled();
    expect(lockPdf).toHaveBeenCalledTimes(1);
  });

  it('refuses an over-cap upload from a signed-in user without recording it', async () => {
    signIn('Basic');

    const res = await lock(pdfFile(51 * MB));

    expect(res.status).toBe(400);
    expect(lockPdf).not.toHaveBeenCalled();
    expect(saveConversionRecord).not.toHaveBeenCalled();
  });
});

describe('lock-pdf database use', () => {
  it('locks for a guest without connecting to the database', async () => {
    const res = await lock(pdfFile());

    expect(res.status).toBe(200);
    expect(dbConnect).not.toHaveBeenCalled();
  });

  it('locks for a guest while the database is down', async () => {
    (dbConnect as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await lock(pdfFile());

    expect(res.status).toBe(200);
  });

  it('locks and records history for a signed-in user', async () => {
    signIn('Pro');

    const res = await lock(pdfFile());

    expect(res.status).toBe(200);
    const locked = Buffer.from(await res.arrayBuffer());
    expect(locked.subarray(0, 5).toString()).toBe('%PDF-');
    expect(locked.includes('/Encrypt')).toBe(true);
    expect(dbConnect).toHaveBeenCalled();
    expect(saveConversionRecord).toHaveBeenCalledTimes(1);
    expect(saveConversionRecord).toHaveBeenCalledWith(USER_ID, 'Lock PDF', 'locked_contract.pdf', locked);
  });
});
