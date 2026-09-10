import { NextRequest } from 'next/server';
import { ClientError } from '@/lib/convert/errors';

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

const compressVideo = jest.fn();
jest.mock('@/lib/video/compress', () => ({
  compressVideo: (...args: any[]) => compressVideo(...args),
}));

import { POST as handleVideoCompress } from '../app/api/convert/video-compress/route';

function fakeFile(buffer: Buffer, name = 'clip.mp4', type = 'video/mp4') {
  return {
    name,
    type,
    size: buffer.length,
    arrayBuffer: jest
      .fn()
      .mockResolvedValue(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
  };
}

function videoRequest() {
  return new NextRequest('http://localhost:3000/api/convert/video-compress', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('video-compress route error handling', () => {
  it('compresses a valid video: 200, mp4 body returned unchanged', async () => {
    const encoded = Buffer.from('fake-mp4-payload');
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
    compressVideo.mockResolvedValueOnce(encoded);

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(encoded)).toBe(true);
  });

  it('returns 400, not 500, for a 0-byte file', async () => {
    mockResolvedFiles = [fakeFile(Buffer.alloc(0))];
    compressVideo.mockRejectedValueOnce(new ClientError('The video file is empty.'));

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it('returns 400, not 500, for a non-video upload', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('%PDF-1.7 not a video'), 'doc.pdf', 'application/pdf')];
    compressVideo.mockRejectedValueOnce(
      new ClientError('That file could not be read as a video.', 400),
    );

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/could not be read as a video/i);
  });

  it('returns 400, not 500, for a corrupted video', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('\x00\x00\x00\x18ftyp rubbish rubbish'), 'broken.mp4')];
    compressVideo.mockRejectedValueOnce(
      new ClientError('That file could not be read as a video.', 400),
    );

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/could not be read as a video/i);
  });

  it('still returns 500 for a genuine server fault', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
    compressVideo.mockRejectedValueOnce(new Error('ffmpeg process crashed'));

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to compress video');
  });

  it('does not turn a history-write failure into a 500', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
    compressVideo.mockResolvedValueOnce(Buffer.from('fake-mp4-payload'));
    conversionCreate.mockRejectedValueOnce(new Error('mongo timeout'));

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(Buffer.from('fake-mp4-payload'))).toBe(true);
    expect(conversionCreate).toHaveBeenCalledTimes(1);
  });
});
