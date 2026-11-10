const mockPut = jest.fn().mockResolvedValue(undefined);
const mockFindUser = jest.fn();
const mockCreate = jest.fn((data: Record<string, unknown>) => Promise.resolve(data));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/storage', () => ({
  getStorage: () => ({ put: mockPut }),
  LocalDiskStorage: class {},
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findById: (id: string) => mockFindUser(id) },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: (data: Record<string, unknown>) => mockCreate(data), find: jest.fn().mockResolvedValue([]) },
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: { find: jest.fn().mockResolvedValue([]) },
}));

import { saveConversionRecord } from '@/lib/conversions';

const USER_ID = '507f1f77bcf86cd799439011';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('saveConversionRecord and the auto-delete preference', () => {
  beforeEach(() => {
    mockPut.mockClear();
    mockCreate.mockClear();
    mockFindUser.mockReset();
  });

  it('stores nothing for an auto-delete user and records a history row without a download', async () => {
    mockFindUser.mockResolvedValue({ plan: 'Pro', preferences: { autoDelete: true } });
    const metadata = { pages: 3 };

    const before = Date.now();
    const conversion = await saveConversionRecord(USER_ID, 'Merge PDF', 'merged.pdf', Buffer.from('12345'), metadata);

    expect(mockPut).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const row = mockCreate.mock.calls[0][0];
    expect(row).toMatchObject({
      userId: USER_ID,
      toolUsed: 'Merge PDF',
      fileName: 'merged.pdf',
      fileSize: 5,
      status: 'Completed',
      metadata,
    });
    expect(row.outputUrl).toBeUndefined();
    expect(row.diskFileName).toBeUndefined();
    const expiresIn = (row.expiresAt as Date).getTime() - before;
    expect(expiresIn).toBeGreaterThan(0);
    expect(expiresIn).toBeLessThan(DAY_MS);
    expect(conversion).toBe(await mockCreate.mock.results[0].value);
  });

  it('still refuses an unsupported output type for an auto-delete user', async () => {
    mockFindUser.mockResolvedValue({ plan: 'Basic', preferences: { autoDelete: true } });

    await expect(
      saveConversionRecord(USER_ID, 'Merge PDF', 'merged.exe', Buffer.from('x'))
    ).rejects.toThrow('unsupported output type');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('stores the file and links it for a user without auto-delete', async () => {
    mockFindUser.mockResolvedValue({ plan: 'Basic', preferences: { autoDelete: false } });

    const before = Date.now();
    await saveConversionRecord(USER_ID, 'Merge PDF', 'merged.pdf', Buffer.from('12345'), { pages: 1 });

    expect(mockPut).toHaveBeenCalledTimes(1);
    const [key, data] = mockPut.mock.calls[0];
    expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(data).toEqual(Buffer.from('12345'));
    const row = mockCreate.mock.calls[0][0];
    expect(row.diskFileName).toBe(key);
    expect(row.outputUrl).toBe(`/api/download/${key.replace('.pdf', '')}`);
    expect(row.metadata).toEqual({ pages: 1 });
    expect((row.expiresAt as Date).getTime() - before).toBeGreaterThan(DAY_MS);
  });

  it('stores the file for a user with no preferences set', async () => {
    mockFindUser.mockResolvedValue({ plan: 'Basic' });

    await saveConversionRecord(USER_ID, 'Merge PDF', 'merged.pdf', Buffer.from('x'));

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].outputUrl).toMatch(/^\/api\/download\//);
  });

  it('stores nothing and records nothing when the user no longer exists', async () => {
    mockFindUser.mockResolvedValue(null);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(saveConversionRecord(USER_ID, 'Merge PDF', 'merged.pdf', Buffer.from('x'))).resolves.toBeNull();

    expect(mockPut).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
