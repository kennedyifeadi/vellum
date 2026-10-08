import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db/mongoose';

const MB = 1024 * 1024;
const USER_ID = '507f1f77bcf86cd799439011';
const PDF = Buffer.from('%PDF-1.7 converted');

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

const saveConversionRecord = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: (...args: unknown[]) => saveConversionRecord(...args),
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const mockConvertImagesToPdf = jest.fn();
jest.mock('@/lib/image/to-pdf', () => ({
  convertImagesToPdf: (...args: unknown[]) => mockConvertImagesToPdf(...args),
}));

import { POST as handleImageToPdf } from '../app/api/convert/image-to-pdf/route';

/**
 * The size gate reads only each upload's reported size, so a few bytes reporting a
 * large size stand in for a multi-megabyte fixture. `arrayBuffer` is a spy so a test
 * can assert the upload was never read.
 */
function imageFile(reportedSize: number, name = 'scan.png') {
  return {
    name,
    type: 'image/png',
    size: reportedSize,
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  };
}

function convert(files: ReturnType<typeof imageFile>[]) {
  mockResolvedFiles = files;
  return handleImageToPdf(
    new NextRequest('http://localhost:3000/api/convert/image-to-pdf', { method: 'POST', body: new FormData() }),
  );
}

function signIn(plan: string | undefined) {
  mockUserId = USER_ID;
  mockPlan = plan;
}

function sizeLimitMessage(capMb: number) {
  return `Your current plan allows up to ${capMb}MB of images per conversion.`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockConvertImagesToPdf.mockResolvedValue(PDF);
  (dbConnect as jest.Mock).mockResolvedValue(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('image-to-pdf per-plan total upload size limit', () => {
  it('refuses an over-cap guest upload without reading or converting it', async () => {
    const file = imageFile(60 * MB);

    const res = await convert([file]);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: sizeLimitMessage(25) });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(mockConvertImagesToPdf).not.toHaveBeenCalled();
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
    const overCap = imageFile(capMb * MB + 1);

    const accepted = await convert([imageFile(capMb * MB)]);
    const refused = await convert([overCap]);

    expect(accepted.status).toBe(200);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: sizeLimitMessage(capMb) });
    expect(overCap.arrayBuffer).not.toHaveBeenCalled();
    expect(mockConvertImagesToPdf).toHaveBeenCalledTimes(1);
  });

  it('counts the images of a request together', async () => {
    const atCap = [imageFile(10 * MB), imageFile(10 * MB), imageFile(5 * MB)];
    const overCap = [imageFile(10 * MB), imageFile(10 * MB), imageFile(5 * MB + 1)];

    const accepted = await convert(atCap);
    const refused = await convert(overCap);

    expect(accepted.status).toBe(200);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: sizeLimitMessage(25) });
    for (const file of overCap) {
      expect(file.arrayBuffer).not.toHaveBeenCalled();
    }
  });

  it('reports too many files before too many bytes, as it did', async () => {
    const res = await convert([imageFile(20 * MB), imageFile(20 * MB), imageFile(20 * MB), imageFile(20 * MB)]);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Your current plan allows up to 3 files per conversion.' });
  });

  it('refuses an over-cap upload from a signed-in user without recording it', async () => {
    signIn('Basic');

    const res = await convert([imageFile(51 * MB)]);

    expect(res.status).toBe(400);
    expect(mockConvertImagesToPdf).not.toHaveBeenCalled();
    expect(saveConversionRecord).not.toHaveBeenCalled();
  });
});

describe('image-to-pdf database use', () => {
  it('converts for a guest without connecting to the database', async () => {
    const res = await convert([imageFile(1 * MB)]);

    expect(res.status).toBe(200);
    expect(dbConnect).not.toHaveBeenCalled();
    expect(saveConversionRecord).not.toHaveBeenCalled();
  });

  it('converts for a guest while the database is down', async () => {
    (dbConnect as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await convert([imageFile(1 * MB)]);

    expect(res.status).toBe(200);
  });

  it('converts and records history for a signed-in user', async () => {
    signIn('Pro');

    const res = await convert([imageFile(1 * MB, 'holiday.photo.png'), imageFile(1 * MB)]);

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect(dbConnect).toHaveBeenCalled();
    expect(saveConversionRecord).toHaveBeenCalledTimes(1);
    expect(saveConversionRecord).toHaveBeenCalledWith(USER_ID, 'Image to PDF', 'holiday.pdf', PDF);
  });
});
