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

jest.mock('@/lib/image/to-png', () => ({
  convertJpegToPng: jest.fn((opts: any) => jest.requireActual('@/lib/image/to-png').convertJpegToPng(opts)),
}));

import { POST as handleJpgToPng } from '../app/api/convert/jpg-to-png/route';
import { convertJpegToPng } from '@/lib/image/to-png';

const convertJpegToPngMock = convertJpegToPng as jest.Mock;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function createJpeg(size = 40): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();
}

function fakeFile(buffer: Buffer, name = 'pic.jpg', type = 'image/jpeg') {
  return {
    name,
    type,
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function jpgRequest() {
  return new NextRequest('http://localhost:3000/api/convert/jpg-to-png', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  convertJpegToPngMock.mockImplementation((opts: any) =>
    jest.requireActual('@/lib/image/to-png').convertJpegToPng(opts)
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('jpg-to-png route error handling', () => {
  it('converts a valid JPEG: 200, png body', async () => {
    mockResolvedFiles = [fakeFile(await createJpeg())];

    const res = await handleJpgToPng(jpgRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('returns the converted PNG byte-for-byte unchanged', async () => {
    mockResolvedFiles = [fakeFile(await createJpeg())];
    const expected = Buffer.concat([PNG_SIGNATURE, Buffer.from('stub-png-payload')]);
    convertJpegToPngMock.mockResolvedValueOnce(expected);

    const res = await handleJpgToPng(jpgRequest());

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(expected)).toBe(true);
  });

  it('returns 400, not 500, for a 0-byte file', async () => {
    mockResolvedFiles = [fakeFile(Buffer.alloc(0))];

    const res = await handleJpgToPng(jpgRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it('returns 400, not 500, for a non-image upload', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('this is definitely not an image'), 'notes.txt', 'text/plain')];

    const res = await handleJpgToPng(jpgRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid image/i);
  });

  it('returns 400, not 500, for a corrupted image', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('\xff\xd8\xff rubbish rubbish rubbish'), 'broken.jpg')];

    const res = await handleJpgToPng(jpgRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid image/i);
  });

  it('still returns 500 for a genuine server fault', async () => {
    mockResolvedFiles = [fakeFile(await createJpeg())];
    convertJpegToPngMock.mockRejectedValueOnce(new Error('sharp: worker pool crashed'));

    const res = await handleJpgToPng(jpgRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to convert images to PNG');
  });

  it('does not turn a history-write failure into a 500', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockResolvedFiles = [fakeFile(await createJpeg())];
    conversionCreate.mockRejectedValueOnce(new Error('mongo timeout'));

    const res = await handleJpgToPng(jpgRequest());

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(conversionCreate).toHaveBeenCalledTimes(1);
  });
});
