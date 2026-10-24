import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db/mongoose';
import { flatImage, uploadedFile } from './helpers/imageSamples';

const MB = 1024 * 1024;
const USER_ID = '507f1f77bcf86cd799439011';

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

const conversionCreate = jest.fn().mockResolvedValue(true);
jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: (...args: unknown[]) => conversionCreate(...args) },
}));

const mockStoragePut = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/storage', () => ({
  getStorage: () => ({ put: mockStoragePut }),
  LocalDiskStorage: class {},
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('@/lib/image/to-png', () => ({
  ...jest.requireActual('@/lib/image/to-png'),
  convertJpegToPng: jest.fn((...args: unknown[]) => jest.requireActual('@/lib/image/to-png').convertJpegToPng(...args)),
}));

// Lets a test make the response headers impossible to build, as an unencodable file name
// once did.
jest.mock('@/lib/http/content-disposition', () => {
  const actual = jest.requireActual('@/lib/http/content-disposition');
  return { attachmentDisposition: jest.fn(actual.attachmentDisposition) };
});

import { POST as handleJpgToPng } from '../app/api/convert/jpg-to-png/route';
import { convertJpegToPng } from '@/lib/image/to-png';
import { attachmentDisposition } from '@/lib/http/content-disposition';

const convertJpegToPngMock = convertJpegToPng as jest.Mock;

jest.setTimeout(60_000);

const SIZE_CAPS_MB: [string, number][] = [
  ['Free', 25],
  ['Basic', 50],
  ['Pro', 100],
  ['Enterprise', 500],
];

function convert(files: unknown[]) {
  mockResolvedFiles = files;
  return handleJpgToPng(
    new NextRequest('http://localhost:3000/api/convert/jpg-to-png', { method: 'POST', body: new FormData() }),
  );
}

// Jobs that run at once must come from different signed-in users: a caller runs one job
// at a time, and guests together hold one slot. The user id is read as the request starts.
function asUser<Result>(userId: string, send: () => Result): Result {
  mockUserId = userId;
  try {
    return send();
  } finally {
    mockUserId = null;
  }
}

function smallJpeg(): Promise<Buffer> {
  return flatImage(16, 16).jpeg().toBuffer();
}

/**
 * A small baseline JPEG whose frame header claims another size, so that only a refusal
 * read from the header can name that size: decoding it would fail.
 */
async function jpegClaimingSize(width: number, height: number): Promise<Buffer> {
  const jpeg = Buffer.from(await smallJpeg());
  const frame = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  jpeg.writeUInt16BE(height, frame + 5);
  jpeg.writeUInt16BE(width, frame + 7);
  return jpeg;
}

function deferred() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { released, release };
}

beforeEach(() => {
  jest.clearAllMocks();
  (dbConnect as jest.Mock).mockResolvedValue(true);
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  convertJpegToPngMock.mockImplementation((...args: unknown[]) =>
    jest.requireActual('@/lib/image/to-png').convertJpegToPng(...args),
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('jpg-to-png total upload size', () => {
  it.each(SIZE_CAPS_MB)('allows a %s plan %d MB in all and refuses one byte more', async (plan, capMb) => {
    mockUserId = USER_ID;
    mockPlan = plan;
    const jpeg = await smallJpeg();

    const atCap = await convert([uploadedFile(jpeg, 'a.jpg', capMb * MB - 10), uploadedFile(jpeg, 'b.jpg', 10)]);
    expect(atCap.status).toBe(200);

    const overCap = [uploadedFile(jpeg, 'a.jpg', capMb * MB - 10), uploadedFile(jpeg, 'b.jpg', 11)];
    const res = await convert(overCap);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`Your current plan allows up to ${capMb}MB of images per conversion.`);
    for (const file of overCap) {
      expect(file.arrayBuffer).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['an unknown plan', 'Platinum'],
    ['a user with no plan', undefined],
  ])('gives %s the guest cap', async (_label, plan) => {
    mockUserId = USER_ID;
    mockPlan = plan;

    const res = await convert([uploadedFile(await smallJpeg(), 'a.jpg', 25 * MB + 1)]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows up to 25MB of images per conversion.');
  });

  it('reports the file-count cap before the size cap', async () => {
    const jpeg = await smallJpeg();

    const res = await convert(Array.from({ length: 4 }, (_, i) => uploadedFile(jpeg, `${i}.jpg`, 10 * MB)));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows up to 3 images per conversion.');
  });
});

describe('jpg-to-png pixels per image', () => {
  it('converts an image of exactly 50 megapixels', async () => {
    const jpeg = await flatImage(10_000, 5_000).jpeg().toBuffer();

    const res = await convert([uploadedFile(jpeg, 'big.jpg')]);

    expect(res.status).toBe(200);
  });

  it('refuses an image one row over 50 megapixels by name, from its header, before any decode', async () => {
    const jpeg = await smallJpeg();

    const res = await convert([uploadedFile(jpeg, 'a.jpg'), uploadedFile(await jpegClaimingSize(10_000, 5_001), 'b.jpg')]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Image 2 is 50.1 megapixels. Each image can be at most 50 megapixels.');
    expect(convertJpegToPngMock).not.toHaveBeenCalled();
  });

  it('refuses an image far beyond sharp’s own limit with the same message', async () => {
    const res = await convert([uploadedFile(await jpegClaimingSize(30_000, 30_000), 'huge.jpg')]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Image 1 is 900.0 megapixels. Each image can be at most 50 megapixels.');
  });
});

describe('jpg-to-png and the database', () => {
  it('never connects for a guest, and serves one while it is down', async () => {
    (dbConnect as jest.Mock).mockRejectedValue(new Error('MongoServerSelectionError'));

    const res = await convert([uploadedFile(await smallJpeg(), 'a.jpg')]);

    expect(res.status).toBe(200);
    expect(dbConnect).not.toHaveBeenCalled();
  });

  it('gives an over-cap guest the cap message while it is down', async () => {
    (dbConnect as jest.Mock).mockRejectedValue(new Error('MongoServerSelectionError'));
    const jpeg = await smallJpeg();

    const res = await convert(Array.from({ length: 4 }, (_, i) => uploadedFile(jpeg, `${i}.jpg`)));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows up to 3 images per conversion.');
  });
});

describe('jpg-to-png when busy', () => {
  it('answers 503 with Retry-After while two conversions run, and converts again once they finish', async () => {
    const jpeg = await smallJpeg();
    const gate = deferred();
    convertJpegToPngMock.mockImplementation(async (...args: unknown[]) => {
      await gate.released;
      return jest.requireActual('@/lib/image/to-png').convertJpegToPng(...args);
    });

    const running = [
      asUser('user-a', () => convert([uploadedFile(jpeg, 'a.jpg')])),
      asUser('user-b', () => convert([uploadedFile(jpeg, 'b.jpg')])),
    ];
    await new Promise((resolve) => setImmediate(resolve));
    while (convertJpegToPngMock.mock.calls.length < 2) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const refused = await asUser('user-c', () => convert([uploadedFile(jpeg, 'c.jpg')]));
    expect(refused.status).toBe(503);
    expect(refused.headers.get('Retry-After')).toBe('5');
    expect((await refused.json()).error).toBe('JPEG to PNG is busy right now. Please try again in a few seconds.');

    gate.release();
    expect((await Promise.all(running)).map((res) => res.status)).toEqual([200, 200]);
    expect((await convert([uploadedFile(jpeg, 'd.jpg')])).status).toBe(200);
  });

  it('frees the slot when a conversion fails', async () => {
    const jpeg = await smallJpeg();
    convertJpegToPngMock.mockRejectedValue(new Error('sharp: worker pool crashed'));

    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await convert([uploadedFile(jpeg, 'a.jpg')])).status).toBe(500);
    }

    convertJpegToPngMock.mockImplementation((...args: unknown[]) =>
      jest.requireActual('@/lib/image/to-png').convertJpegToPng(...args),
    );
    expect((await convert([uploadedFile(jpeg, 'a.jpg')])).status).toBe(200);
  });
});

describe('jpg-to-png history for a signed-in user', () => {
  it('stores an output of exactly 25 MB for download again', async () => {
    mockUserId = USER_ID;
    const output = Buffer.alloc(25 * MB, 1);
    convertJpegToPngMock.mockResolvedValueOnce(output);

    const res = await convert([uploadedFile(await smallJpeg(), 'photo.jpg')]);

    expect(Buffer.from(await res.arrayBuffer()).equals(output)).toBe(true);
    expect(mockStoragePut).toHaveBeenCalledTimes(1);
    expect(conversionCreate.mock.calls[0][0]).toMatchObject({
      toolUsed: 'JPEG to PNG',
      fileName: 'converted_photo.png',
      fileSize: output.length,
      outputUrl: expect.stringMatching(/^\/api\/download\//),
    });
  });

  it('returns but does not store an output one byte over 25 MB, and still records it', async () => {
    mockUserId = USER_ID;
    const output = Buffer.alloc(25 * MB + 1, 1);
    convertJpegToPngMock.mockResolvedValueOnce(output);

    const res = await convert([uploadedFile(await smallJpeg(), 'photo.jpg')]);

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(output)).toBe(true);
    expect(mockStoragePut).not.toHaveBeenCalled();
    expect(conversionCreate).toHaveBeenCalledTimes(1);
    const record = conversionCreate.mock.calls[0][0];
    expect(record).toMatchObject({
      toolUsed: 'JPEG to PNG',
      fileName: 'converted_photo.png',
      fileSize: output.length,
      status: 'Completed',
      metadata: { pages: 1, processedSize: output.length },
    });
    expect(record.outputUrl).toBeUndefined();
    expect(record.diskFileName).toBeUndefined();
  });

  it('applies the same rule to a batch zip', async () => {
    mockUserId = USER_ID;
    mockPlan = 'Pro';
    convertJpegToPngMock.mockImplementation(async () => Buffer.alloc(13 * MB, 1));
    const jpeg = await smallJpeg();

    const res = await convert([uploadedFile(jpeg, 'one.jpg'), uploadedFile(jpeg, 'two.jpg')]);

    expect(res.status).toBe(200);
    expect(mockStoragePut).not.toHaveBeenCalled();
    expect(conversionCreate.mock.calls[0][0]).toMatchObject({ toolUsed: 'JPEG to PNG (Batch)', fileName: 'converted_images.zip' });
  });

  it('stores nothing and records nothing when the response cannot be built', async () => {
    mockUserId = USER_ID;
    jest.mocked(attachmentDisposition).mockImplementationOnce(() => {
      throw new TypeError('Cannot convert argument to a ByteString');
    });

    const res = await convert([uploadedFile(await smallJpeg(), 'photo.jpg')]);

    expect(res.status).toBe(500);
    expect(mockStoragePut).not.toHaveBeenCalled();
    expect(conversionCreate).not.toHaveBeenCalled();
  });
});
