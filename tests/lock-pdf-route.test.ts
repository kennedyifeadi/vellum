import { NextRequest } from 'next/server';

const LOCKED_PDF = Buffer.from('%PDF-1.7 locked-payload');

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

const lockPdf = jest.fn();
jest.mock('@/lib/pdf/lock', () => ({
  ...jest.requireActual('@/lib/pdf/lock'),
  lockPdf: (...args: any[]) => lockPdf(...args),
}));

import { POST as handleLockPdf } from '../app/api/convert/lock-pdf/route';

function fakeFile(name = 'contract.pdf') {
  const buffer = Buffer.from('%PDF-1.7 input');
  return {
    name,
    type: 'application/pdf',
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function lockRequest(password = 'correct horse') {
  const formData = new FormData();
  formData.append('password', password);
  return new NextRequest('http://localhost:3000/api/convert/lock-pdf', { method: 'POST', body: formData });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockResolvedFiles = [fakeFile()];
  lockPdf.mockResolvedValue(LOCKED_PDF);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('lock-pdf route history', () => {
  it('records the locked PDF for a signed-in user', async () => {
    mockUserId = '507f1f77bcf86cd799439011';

    const res = await handleLockPdf(lockRequest());

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(LOCKED_PDF)).toBe(true);
    expect(saveConversionRecord).toHaveBeenCalledTimes(1);
    expect(saveConversionRecord).toHaveBeenCalledWith(mockUserId, 'Lock PDF', 'locked_contract.pdf', LOCKED_PDF);
  });

  it('still returns the locked PDF when the history write fails', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    const recordError = new Error('mongo timeout');
    saveConversionRecord.mockRejectedValueOnce(recordError);

    const res = await handleLockPdf(lockRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(Buffer.from(await res.arrayBuffer()).equals(LOCKED_PDF)).toBe(true);
    expect(saveConversionRecord).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('Failed to record Lock PDF conversion:', recordError);
  });

  it('records nothing for a guest', async () => {
    const res = await handleLockPdf(lockRequest());

    expect(res.status).toBe(200);
    expect(saveConversionRecord).not.toHaveBeenCalled();
  });

  it('still returns 500 when locking itself fails', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    lockPdf.mockRejectedValueOnce(new Error('encryption failed'));

    const res = await handleLockPdf(lockRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to lock PDF.' });
    expect(saveConversionRecord).not.toHaveBeenCalled();
  });

  it('rejects an invalid password before locking or recording', async () => {
    mockUserId = '507f1f77bcf86cd799439011';

    const res = await handleLockPdf(lockRequest('abc'));

    expect(res.status).toBe(400);
    expect(lockPdf).not.toHaveBeenCalled();
    expect(saveConversionRecord).not.toHaveBeenCalled();
  });
});
