import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { LocalDiskStorage } from '@/lib/storage/local';

const USER = '507f1f77bcf86cd799439011';
const OTHER_USER = '507f1f77bcf86cd799439022';

type Row = { userId: string; diskFileName?: string };

let mockStorage: LocalDiskStorage;
let mockConversions: Row[] = [];
let mockDocuments: Row[] = [];

function mockRowModel(rows: () => Row[], replace: (next: Row[]) => void) {
  return {
    find: jest.fn((filter: { userId: string }) =>
      Promise.resolve(rows().filter((row) => row.userId === filter.userId))
    ),
    deleteMany: jest.fn((filter: { userId: string }) => {
      replace(rows().filter((row) => row.userId !== filter.userId));
      return Promise.resolve({});
    }),
  };
}

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn(() => Promise.resolve(USER)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn(() => Promise.resolve({ delete: jest.fn() })),
}));

jest.mock('@/lib/storage', () => ({
  getStorage: () => mockStorage,
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findByIdAndDelete: jest.fn(() => Promise.resolve({})) },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: mockRowModel(() => mockConversions, (next) => { mockConversions = next; }),
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: mockRowModel(() => mockDocuments, (next) => { mockDocuments = next; }),
}));

import { DELETE as deleteAccount } from '../app/api/user/delete/route';

jest.setTimeout(30_000);

describe('DELETE /api/user/delete', () => {
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-account-delete-test-'));
    mockStorage = new LocalDiskStorage(root);
    mockConversions = [
      { userId: USER, diskFileName: 'mine.pdf' },
      { userId: OTHER_USER, diskFileName: 'theirs.pdf' },
    ];
    mockDocuments = [
      { userId: USER, diskFileName: 'my-doc.pdf' },
      { userId: OTHER_USER, diskFileName: 'their-doc.pdf' },
    ];
    for (const key of ['mine.pdf', 'theirs.pdf', 'docs/my-doc.pdf', 'docs/their-doc.pdf']) {
      await mockStorage.put(key, Buffer.from(key));
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const stored = (key: string) => fs.existsSync(path.join(root, key));
  const request = () => new NextRequest('http://localhost:3000/api/user/delete', { method: 'DELETE' });

  it("removes the user's documents and their files, and leaves other users' alone", async () => {
    const res = await deleteAccount(request());

    expect(res.status).toBe(200);
    expect(stored('docs/my-doc.pdf')).toBe(false);
    expect(stored('mine.pdf')).toBe(false);
    expect(mockDocuments).toEqual([{ userId: OTHER_USER, diskFileName: 'their-doc.pdf' }]);
    expect(mockConversions).toEqual([{ userId: OTHER_USER, diskFileName: 'theirs.pdf' }]);
    expect(stored('docs/their-doc.pdf')).toBe(true);
    expect(stored('theirs.pdf')).toBe(true);
  });

  it('still deletes the account when a document file cannot be removed, and logs it', async () => {
    const realDelete = mockStorage.delete.bind(mockStorage);
    jest.spyOn(mockStorage, 'delete').mockImplementation((key: string) =>
      key === 'docs/my-doc.pdf' ? Promise.reject(new Error('disk busy')) : realDelete(key)
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await deleteAccount(request());

    expect(res.status).toBe(200);
    expect(mockDocuments).toEqual([{ userId: OTHER_USER, diskFileName: 'their-doc.pdf' }]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('docs/my-doc.pdf'), expect.any(Error));
  });
});
