import { NextRequest } from 'next/server';
import sharp from 'sharp';

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

const conversionCreate = jest.fn().mockResolvedValue(true);
jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: (...args: any[]) => conversionCreate(...args) },
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('@/lib/image/compress', () => ({
  compressImage: jest.fn((opts: any) => jest.requireActual('@/lib/image/compress').compressImage(opts)),
}));

import { POST as handleImageCompress } from '../app/api/convert/image-compress/route';
import { compressImage } from '@/lib/image/compress';

const compressImageMock = compressImage as jest.Mock;

async function createPng(size = 40): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
}

function fakeFile(buffer: Buffer, name = 'pic.png', type = 'image/png') {
  return {
    name,
    type,
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function compressRequest() {
  return new NextRequest('http://localhost:3000/api/convert/image-compress', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  compressImageMock.mockImplementation((opts: any) =>
    jest.requireActual('@/lib/image/compress').compressImage(opts)
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('image-compress route error handling', () => {
  it('compresses a valid image: 200, image body, size headers', async () => {
    mockResolvedFiles = [fakeFile(await createPng())];

    const res = await handleImageCompress(compressRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Original-Size')).toBeTruthy();
    expect(res.headers.get('X-Compressed-Size')).toBeTruthy();
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns the compressed bytes unchanged', async () => {
    mockResolvedFiles = [fakeFile(await createPng())];
    const expected = Buffer.from('stub-compressed-image-bytes');
    compressImageMock.mockResolvedValueOnce(expected);

    const res = await handleImageCompress(compressRequest());

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(expected)).toBe(true);
  });

  it('returns 400, not 500, for a 0-byte file', async () => {
    mockResolvedFiles = [fakeFile(Buffer.alloc(0))];

    const res = await handleImageCompress(compressRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it('returns 400, not 500, for a non-image upload', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('this is definitely not an image'), 'notes.txt', 'text/plain')];

    const res = await handleImageCompress(compressRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid image/i);
  });

  it('returns 400, not 500, for a corrupted image', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('\x89PNG\r\n\x1a\n rubbish rubbish rubbish'), 'broken.png')];

    const res = await handleImageCompress(compressRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid image/i);
  });

  it('still returns 500 for a genuine server fault', async () => {
    mockResolvedFiles = [fakeFile(await createPng())];
    compressImageMock.mockRejectedValueOnce(new Error('sharp: worker pool crashed'));

    const res = await handleImageCompress(compressRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to compress images');
  });

  it('does not turn a history-write failure into a 500', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockResolvedFiles = [fakeFile(await createPng())];
    conversionCreate.mockRejectedValueOnce(new Error('mongo timeout'));

    const res = await handleImageCompress(compressRequest());

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    expect(conversionCreate).toHaveBeenCalledTimes(1);
  });
});
