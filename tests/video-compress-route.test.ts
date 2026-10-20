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

const mockStoragePut = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/storage', () => ({
  getStorage: () => ({ put: mockStoragePut }),
  LocalDiskStorage: class {},
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

const compressVideo = jest.fn();
const MP4 = { extension: 'mp4', contentType: 'video/mp4' };
const encoded = (bytes: Buffer) => ({ bytes, compressed: true, format: MP4 });
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

function expectStandardRetention(record: any, startedAt: number) {
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const retentionMs = new Date(record.expiresAt).getTime() - startedAt;
  expect(retentionMs).toBeGreaterThanOrEqual(threeDaysMs - 5000);
  expect(retentionMs).toBeLessThanOrEqual(threeDaysMs + 5000);
}

function videoRequest() {
  return new NextRequest('http://localhost:3000/api/convert/video-compress', {
    method: 'POST',
    body: new FormData(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  compressVideo.mockReset();
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
    const encodedBytes = Buffer.from('fake-mp4-payload');
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
    compressVideo.mockResolvedValueOnce(encoded(encodedBytes));

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(encodedBytes)).toBe(true);
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
    compressVideo.mockResolvedValueOnce(encoded(Buffer.from('fake-mp4-payload')));
    conversionCreate.mockRejectedValueOnce(new Error('mongo timeout'));

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(Buffer.from('fake-mp4-payload'))).toBe(true);
    expect(conversionCreate).toHaveBeenCalledTimes(1);
  });

  it('records the compression as history-only: no stored output', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    const input = Buffer.from('raw-input');
    const encodedBytes = Buffer.from('fake-mp4-payload');
    mockResolvedFiles = [fakeFile(input)];
    compressVideo.mockResolvedValueOnce(encoded(encodedBytes));
    const startedAt = Date.now();

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(200);
    expect(conversionCreate).toHaveBeenCalledTimes(1);
    const record = conversionCreate.mock.calls[0][0];
    expect(record).toMatchObject({
      toolUsed: 'Compress Video',
      fileName: 'clip.mp4',
      fileSize: input.length,
      status: 'Completed',
      metadata: { pages: 1, processedSize: encodedBytes.length },
    });
    expect(record.outputUrl).toBeUndefined();
    expect(record.diskFileName).toBeUndefined();
    expectStandardRetention(record, startedAt);
    expect(mockStoragePut).not.toHaveBeenCalled();
  });
});

describe('video-compress encode limits', () => {
  it('gives each plan its own length cap and deadline', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockPlan = 'Pro';
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
    compressVideo.mockResolvedValueOnce(encoded(Buffer.from('mp4')));

    await handleVideoCompress(videoRequest());

    expect(compressVideo.mock.calls[0][0]).toMatchObject({ maxDurationSeconds: 30 * 60 });
    expect(compressVideo.mock.calls[0][0].encodeDeadlineMs).toBeGreaterThan(0);
  });
});

const MB = 1024 * 1024;

function oversizedFile(size: number, name = 'clip.mp4') {
  return {
    name,
    type: 'video/mp4',
    size,
    arrayBuffer: jest.fn().mockRejectedValue(new Error('an over-cap upload must not be read')),
  };
}

function deferred() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { released, release };
}

async function untilCalled(mock: jest.Mock, times: number): Promise<void> {
  while (mock.mock.calls.length < times) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('video-compress size caps', () => {
  it.each([
    ['a guest', null, 'Free', 50],
    ['an unknown plan', '507f1f77bcf86cd799439011', 'Platinum', 50],
    ['a Basic user', '507f1f77bcf86cd799439011', 'Basic', 100],
    ['a Pro user', '507f1f77bcf86cd799439011', 'Pro', 500],
    ['an Enterprise user', '507f1f77bcf86cd799439011', 'Enterprise', 500],
  ])('refuses %s a video over the plan cap, before reading it', async (_label, userId, plan, capMb) => {
    mockUserId = userId;
    mockPlan = plan;
    const file = oversizedFile(capMb * MB + 1);
    mockResolvedFiles = [file];

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`Your current plan allows videos up to ${capMb}MB.`);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(compressVideo).not.toHaveBeenCalled();
  });

  it.each([
    ['a guest', null, 'Free', 50],
    ['an Enterprise user', '507f1f77bcf86cd799439011', 'Enterprise', 500],
  ])('accepts %s a video exactly at the cap', async (_label, userId, plan, capMb) => {
    mockUserId = userId;
    mockPlan = plan;
    mockResolvedFiles = [{ ...fakeFile(Buffer.from('raw-input')), size: capMb * MB }];
    compressVideo.mockResolvedValueOnce(encoded(Buffer.from('mp4')));

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(200);
  });
});

describe('video-compress for guests', () => {
  it('never connects to the database, and serves a guest while it is down', async () => {
    const dbConnect = jest.requireMock('@/lib/db/mongoose').default as jest.Mock;
    dbConnect.mockRejectedValue(new Error('MongoServerSelectionError: connect ECONNREFUSED'));
    try {
      mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
      compressVideo.mockResolvedValueOnce(encoded(Buffer.from('mp4')));
      const served = await handleVideoCompress(videoRequest());

      mockResolvedFiles = [oversizedFile(51 * MB)];
      const refused = await handleVideoCompress(videoRequest());

      expect(served.status).toBe(200);
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toBe('Your current plan allows videos up to 50MB.');
      expect(dbConnect).not.toHaveBeenCalled();
    } finally {
      dbConnect.mockResolvedValue(true);
    }
  });
});

describe('video-compress when busy', () => {
  it('answers 503 with Retry-After while two encodes run, and compresses again once they finish', async () => {
    const gate = deferred();
    compressVideo.mockImplementation(async () => {
      await gate.released;
      return encoded(Buffer.from('mp4'));
    });
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];

    const running = [handleVideoCompress(videoRequest()), handleVideoCompress(videoRequest())];
    await untilCalled(compressVideo, 2);

    const refused = await handleVideoCompress(videoRequest());
    expect(refused.status).toBe(503);
    expect(refused.headers.get('Retry-After')).toBe('5');
    expect((await refused.json()).error).toBe('Compress Video is busy right now. Please try again in a few seconds.');
    expect(compressVideo).toHaveBeenCalledTimes(2);

    gate.release();
    expect((await Promise.all(running)).map((res) => res.status)).toEqual([200, 200]);
    expect((await handleVideoCompress(videoRequest())).status).toBe(200);
  });

  it('frees its slot when an encode fails', async () => {
    compressVideo.mockRejectedValueOnce(new Error('ffmpeg crashed')).mockRejectedValueOnce(new ClientError('bad'));
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
    await handleVideoCompress(videoRequest());
    await handleVideoCompress(videoRequest());

    compressVideo.mockResolvedValueOnce(encoded(Buffer.from('mp4'))).mockResolvedValueOnce(encoded(Buffer.from('mp4')));
    const statuses = await Promise.all([handleVideoCompress(videoRequest()), handleVideoCompress(videoRequest())]);

    expect(statuses.map((res) => res.status)).toEqual([200, 200]);
  });
});

describe('video-compress response', () => {
  it("hands the request's abort signal to the encode", async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'))];
    compressVideo.mockResolvedValueOnce(encoded(Buffer.from('mp4')));
    const req = videoRequest();

    await handleVideoCompress(req);

    expect(compressVideo.mock.calls[0][0].signal).toBe(req.signal);
  });

  it('returns an original that was not made smaller with its own type, name and a 0% saving', async () => {
    const original = Buffer.from('original-mov-bytes');
    mockResolvedFiles = [fakeFile(original, 'holiday.mov', 'video/quicktime')];
    compressVideo.mockResolvedValueOnce({
      bytes: original,
      compressed: false,
      format: { extension: 'mov', contentType: 'video/quicktime' },
    });

    const res = await handleVideoCompress(videoRequest());

    expect(res.headers.get('Content-Type')).toBe('video/quicktime');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="compressed_holiday.mov"');
    expect(res.headers.get('X-Original-Size')).toBe(String(original.length));
    expect(res.headers.get('X-Compressed-Size')).toBe(String(original.length));
    expect(res.headers.get('X-Saved-Percent')).toBe('0');
  });

  it('records nothing when the response cannot be built', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    mockResolvedFiles = [fakeFile(Buffer.from('raw-input'), '動画.mp4')];
    compressVideo.mockResolvedValueOnce(encoded(Buffer.from('mp4')));

    const res = await handleVideoCompress(videoRequest());

    expect(res.status).toBe(500);
    expect(conversionCreate).not.toHaveBeenCalled();
  });
});
