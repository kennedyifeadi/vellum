import { NextRequest } from 'next/server';
import dbConnect from '@/lib/db/mongoose';
import { createPhotoJpeg, flatImage, uploadedFile } from './helpers/imageSamples';
import { createPngWithUnreadablePixels } from './helpers/imageFiles';

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

jest.mock('@/lib/image/compress', () => ({
  ...jest.requireActual('@/lib/image/compress'),
  compressImage: jest.fn((...args: unknown[]) => jest.requireActual('@/lib/image/compress').compressImage(...args)),
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

import { POST as handleImageCompress } from '../app/api/convert/image-compress/route';
import { POST as handleJpgToPng } from '../app/api/convert/jpg-to-png/route';
import { compressImage } from '@/lib/image/compress';
import { convertJpegToPng } from '@/lib/image/to-png';
import { attachmentDisposition } from '@/lib/http/content-disposition';

const compressImageMock = compressImage as jest.Mock;
const convertJpegToPngMock = convertJpegToPng as jest.Mock;

jest.setTimeout(60_000);

const BUSY_MESSAGE = 'Compress Image is busy right now. Please try again in a few seconds.';

const SIZE_CAPS_MB: [string, number][] = [
  ['Free', 25],
  ['Basic', 50],
  ['Pro', 100],
  ['Enterprise', 500],
];

function postTo(handler: typeof handleImageCompress, path: string, files: unknown[]) {
  mockResolvedFiles = files;
  return handler(new NextRequest(`http://localhost:3000${path}`, { method: 'POST', body: new FormData() }));
}

function compress(files: unknown[]) {
  return postTo(handleImageCompress, '/api/convert/image-compress', files);
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

async function untilCalled(mock: jest.Mock, times: number): Promise<void> {
  while (mock.mock.calls.length < times) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function passThroughToLibraries() {
  compressImageMock.mockImplementation((...args: unknown[]) =>
    jest.requireActual('@/lib/image/compress').compressImage(...args),
  );
  convertJpegToPngMock.mockImplementation((...args: unknown[]) =>
    jest.requireActual('@/lib/image/to-png').convertJpegToPng(...args),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (dbConnect as jest.Mock).mockResolvedValue(true);
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  passThroughToLibraries();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('image-compress total upload size', () => {
  it.each(SIZE_CAPS_MB)('allows a %s plan %d MB in all and refuses one byte more', async (plan, capMb) => {
    mockUserId = USER_ID;
    mockPlan = plan;
    const jpeg = await smallJpeg();

    const atCap = await compress([uploadedFile(jpeg, 'a.jpg', capMb * MB - 10), uploadedFile(jpeg, 'b.jpg', 10)]);
    expect(atCap.status).toBe(200);

    const overCap = [uploadedFile(jpeg, 'a.jpg', capMb * MB - 10), uploadedFile(jpeg, 'b.jpg', 11)];
    const res = await compress(overCap);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`Your current plan allows up to ${capMb}MB of images per compression.`);
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

    const res = await compress([uploadedFile(await smallJpeg(), 'a.jpg', 25 * MB + 1)]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows up to 25MB of images per compression.');
  });

  it('reports the file-count cap before the size cap', async () => {
    const jpeg = await smallJpeg();

    const res = await compress(Array.from({ length: 4 }, (_, i) => uploadedFile(jpeg, `${i}.jpg`, 10 * MB)));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows up to 3 images per compression.');
  });
});

describe('image-compress pixels per image', () => {
  it('compresses an image of exactly 50 megapixels', async () => {
    const jpeg = await flatImage(10_000, 5_000).jpeg({ quality: 100 }).toBuffer();

    const res = await compress([uploadedFile(jpeg, 'big.jpg')]);

    expect(res.status).toBe(200);
  });

  it.each([
    ['JPEG', () => jpegClaimingSize(10_000, 5_001)],
    ['PNG', async () => createPngWithUnreadablePixels(10_000, 5_001)],
  ])('refuses a %s one row over 50 megapixels by name, from its header, before any decode', async (_format, createImage) => {
    const res = await compress([uploadedFile(await smallJpeg(), 'a.jpg'), uploadedFile(await createImage(), 'b')]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Image 2 is 50.1 megapixels. Each image can be at most 50 megapixels.');
    expect(compressImageMock).not.toHaveBeenCalled();
  });

  it('refuses an image far beyond sharp’s own limit with the same message', async () => {
    const res = await compress([uploadedFile(createPngWithUnreadablePixels(30_000, 30_000), 'huge.png')]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Image 1 is 900.0 megapixels. Each image can be at most 50 megapixels.');
  });
});

describe('image-compress and the database', () => {
  it('never connects for a guest, and serves one while it is down', async () => {
    (dbConnect as jest.Mock).mockRejectedValue(new Error('MongoServerSelectionError'));

    const res = await compress([uploadedFile(await createPhotoJpeg(320, 240, 100), 'a.jpg')]);

    expect(res.status).toBe(200);
    expect(dbConnect).not.toHaveBeenCalled();
  });

  it('gives an over-cap guest the cap message while it is down', async () => {
    (dbConnect as jest.Mock).mockRejectedValue(new Error('MongoServerSelectionError'));
    const jpeg = await smallJpeg();

    const res = await compress(Array.from({ length: 4 }, (_, i) => uploadedFile(jpeg, `${i}.jpg`)));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Your current plan allows up to 3 images per compression.');
  });

  it('records history for a signed-in user without storing the output', async () => {
    mockUserId = USER_ID;
    const jpeg = await createPhotoJpeg(320, 240, 100);

    const res = await compress([uploadedFile(jpeg, 'photo.jpg')]);
    const body = Buffer.from(await res.arrayBuffer());

    expect(dbConnect).toHaveBeenCalled();
    expect(conversionCreate).toHaveBeenCalledTimes(1);
    expect(conversionCreate.mock.calls[0][0]).toMatchObject({
      toolUsed: 'Compress Image',
      fileName: 'photo.jpg',
      fileSize: jpeg.length,
      metadata: { pages: 1, processedSize: body.length },
    });
    expect(mockStoragePut).not.toHaveBeenCalled();
  });

  it('records nothing when the response cannot be built', async () => {
    mockUserId = USER_ID;
    jest.mocked(attachmentDisposition).mockImplementationOnce(() => {
      throw new TypeError('Cannot convert argument to a ByteString');
    });

    const res = await compress([uploadedFile(await createPhotoJpeg(320, 240, 100), 'photo.jpg')]);

    expect(res.status).toBe(500);
    expect(conversionCreate).not.toHaveBeenCalled();
  });
});

describe('image-compress when busy', () => {
  it('answers 503 with Retry-After while two compressions run, and compresses again once they finish', async () => {
    const jpeg = await smallJpeg();
    const gate = deferred();
    compressImageMock.mockImplementation(async (...args: unknown[]) => {
      await gate.released;
      return jest.requireActual('@/lib/image/compress').compressImage(...args);
    });

    const running = [compress([uploadedFile(jpeg, 'a.jpg')]), compress([uploadedFile(jpeg, 'b.jpg')])];
    await untilCalled(compressImageMock, 2);

    const refused = await compress([uploadedFile(jpeg, 'c.jpg')]);
    expect(refused.status).toBe(503);
    expect(refused.headers.get('Retry-After')).toBe('5');
    expect((await refused.json()).error).toBe(BUSY_MESSAGE);

    gate.release();
    expect((await Promise.all(running)).map((res) => res.status)).toEqual([200, 200]);
    expect((await compress([uploadedFile(jpeg, 'd.jpg')])).status).toBe(200);
  });

  it('shares its limit with JPEG to PNG', async () => {
    const jpeg = await smallJpeg();
    const gate = deferred();
    compressImageMock.mockImplementation(async (...args: unknown[]) => {
      await gate.released;
      return jest.requireActual('@/lib/image/compress').compressImage(...args);
    });
    convertJpegToPngMock.mockImplementation(async (...args: unknown[]) => {
      await gate.released;
      return jest.requireActual('@/lib/image/to-png').convertJpegToPng(...args);
    });

    const running = [compress([uploadedFile(jpeg, 'a.jpg')])];
    await untilCalled(compressImageMock, 1);
    running.push(postTo(handleJpgToPng, '/api/convert/jpg-to-png', [uploadedFile(jpeg, 'b.jpg')]));
    await untilCalled(convertJpegToPngMock, 1);

    expect((await compress([uploadedFile(jpeg, 'c.jpg')])).status).toBe(503);
    const refusedPng = await postTo(handleJpgToPng, '/api/convert/jpg-to-png', [uploadedFile(jpeg, 'd.jpg')]);
    expect(refusedPng.status).toBe(503);
    expect((await refusedPng.json()).error).toBe('JPEG to PNG is busy right now. Please try again in a few seconds.');

    gate.release();
    expect((await Promise.all(running)).map((res) => res.status)).toEqual([200, 200]);
  });

  it('frees the slot when a compression fails', async () => {
    const jpeg = await smallJpeg();
    compressImageMock.mockRejectedValue(new Error('sharp: worker pool crashed'));

    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await compress([uploadedFile(jpeg, 'a.jpg')])).status).toBe(500);
    }

    passThroughToLibraries();
    expect((await compress([uploadedFile(jpeg, 'a.jpg')])).status).toBe(200);
  });
});
