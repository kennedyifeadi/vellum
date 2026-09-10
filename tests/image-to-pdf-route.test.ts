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

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const saveConversionRecord = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: (...args: any[]) => saveConversionRecord(...args),
}));

jest.mock('@/lib/image/to-pdf', () => ({
  convertImagesToPdf: jest.fn((opts: any) =>
    jest.requireActual('@/lib/image/to-pdf').convertImagesToPdf(opts)
  ),
}));

import { POST as handleImageToPdf } from '../app/api/convert/image-to-pdf/route';
import { convertImagesToPdf } from '@/lib/image/to-pdf';

const convertImagesToPdfMock = convertImagesToPdf as jest.Mock;

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

function imageRequest() {
  return new NextRequest('http://localhost:3000/api/convert/image-to-pdf', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  convertImagesToPdfMock.mockImplementation((opts: any) =>
    jest.requireActual('@/lib/image/to-pdf').convertImagesToPdf(opts)
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('image-to-pdf route error handling', () => {
  it('converts a valid PNG unchanged: 200, pdf body', async () => {
    mockResolvedFiles = [fakeFile(await createPng())];

    const res = await handleImageToPdf(imageRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns 400, not 500, for a 0-byte file', async () => {
    mockResolvedFiles = [fakeFile(Buffer.alloc(0))];

    const res = await handleImageToPdf(imageRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/image 1 is empty/i);
  });

  it('returns 400, not 500, for a corrupted image', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('\x89PNG\r\n\x1a\n rubbish rubbish rubbish'), 'broken.png')];

    const res = await handleImageToPdf(imageRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/image 1 is not a valid image or is corrupted/i);
  });

  it('returns 400 with the actionable message for an unsupported format (WebP)', async () => {
    const webp = await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .webp()
      .toBuffer();
    mockResolvedFiles = [fakeFile(webp, 'img.webp', 'image/webp')];

    const res = await handleImageToPdf(imageRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'Unsupported image format. Only PNG and JPEG are supported.'
    );
  });

  it('still returns 500 for a genuine server fault', async () => {
    mockResolvedFiles = [fakeFile(await createPng())];
    convertImagesToPdfMock.mockRejectedValueOnce(new Error('pdf-lib internal invariant'));

    const res = await handleImageToPdf(imageRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to convert images to PDF.');
  });

  it('does not turn a saveConversionRecord failure into a 500', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockResolvedFiles = [fakeFile(await createPng())];
    saveConversionRecord.mockRejectedValueOnce(new Error('mongo timeout'));

    const res = await handleImageToPdf(imageRequest());

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(saveConversionRecord).toHaveBeenCalledTimes(1);
  });
});
