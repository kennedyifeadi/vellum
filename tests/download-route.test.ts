import { NextRequest } from 'next/server';

const OWNER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f1f77bcf86cd799439022';
const FILE_ID = '3f0c1d52-8f5e-4c53-9a44-0b8f1e0c7a11';

let mockUserId: string | null = null;
let mockRecords: any[] = [];
const mockStored = new Map<string, Buffer>();

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockImplementation((query: any) =>
      Promise.resolve(
        mockRecords.find(
          (record) =>
            record.userId === query.userId && new RegExp(query.diskFileName.$regex).test(record.diskFileName),
        ) ?? null,
      ),
    ),
  },
}));

jest.mock('@/lib/storage', () => ({
  getStorage: () => ({ get: async (key: string) => mockStored.get(key) ?? null }),
  LocalDiskStorage: class {},
}));

import { GET as handleDownload } from '../app/api/download/[id]/route';

function storeRecord(extension: string, fileName: string, bytes: Buffer) {
  const diskFileName = `${FILE_ID}${extension}`;
  mockRecords = [{ userId: OWNER_ID, diskFileName, fileName }];
  mockStored.set(diskFileName, bytes);
}

function download(id = FILE_ID) {
  return handleDownload(new NextRequest(`http://localhost:3000/api/download/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = OWNER_ID;
  mockRecords = [];
  mockStored.clear();
});

describe('download route', () => {
  it.each([
    ['.docx', 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['.png', 'converted_photo.png', 'image/png'],
    ['.pdf', 'merged_report.pdf', 'application/pdf'],
    ['.zip', 'split_report.zip', 'application/zip'],
  ])('serves a stored %s under its own name and content type', async (extension, fileName, contentType) => {
    const bytes = Buffer.from(`stored ${extension} bytes`);
    storeRecord(extension, fileName, bytes);

    const res = await download();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(contentType);
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="${fileName}"`);
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('returns 401 without authentication', async () => {
    storeRecord('.docx', 'report.docx', Buffer.from('docx'));
    mockUserId = null;

    const res = await download();

    expect(res.status).toBe(401);
  });

  it("returns 404 for another user's record", async () => {
    storeRecord('.docx', 'report.docx', Buffer.from('docx'));
    mockUserId = OTHER_USER_ID;

    const res = await download();

    expect(res.status).toBe(404);
  });

  it('returns 404 when the stored file is gone', async () => {
    storeRecord('.pdf', 'report.pdf', Buffer.from('pdf'));
    mockStored.clear();

    const res = await download();

    expect(res.status).toBe(404);
  });
});
