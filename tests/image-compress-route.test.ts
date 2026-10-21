import { NextRequest } from 'next/server';
import sharp from 'sharp';
import JSZip from 'jszip';

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

jest.mock('@/lib/image/compress', () => ({
  ...jest.requireActual('@/lib/image/compress'),
  compressImage: jest.fn((...args: unknown[]) => jest.requireActual('@/lib/image/compress').compressImage(...args)),
}));

// sharp itself, with every call recorded, so a test can tell whether an upload was
// handed to it at all.
jest.mock('sharp', () => {
  const actual = jest.requireActual('sharp');
  const recorded = Object.assign(
    jest.fn((...args: unknown[]) => actual(...args)),
    actual,
  );
  return { __esModule: true, default: recorded };
});

import { POST as handleImageCompress } from '../app/api/convert/image-compress/route';
import { compressImage } from '@/lib/image/compress';
import {
  createAnimatedWebp,
  createPhotoJpeg,
  createSvgWithManyElements,
  flatImage,
  magicFormat,
  photoLikePixels,
} from './helpers/imageSamples';
import { createAnimatedPng, createSvgThatTakesMinutesToRender } from './helpers/imageFiles';

const compressImageMock = compressImage as jest.Mock;
const sharpCalls = sharp as unknown as jest.Mock;

jest.setTimeout(60_000);

function wasGivenToSharp(upload: Buffer): boolean {
  return sharpCalls.mock.calls.some(([input]) => Buffer.isBuffer(input) && input.equals(upload));
}

// Photographs saved with little or no compression, which every level makes smaller.
const PHOTOS: [string, string, string, () => Promise<Buffer>][] = [
  ['JPEG', 'image/jpeg', 'jpg', () => createPhotoJpeg(320, 240, 100)],
  ['PNG', 'image/png', 'png', () => photoLikePixels(320, 240).png({ compressionLevel: 0 }).toBuffer()],
  ['WebP', 'image/webp', 'webp', () => photoLikePixels(320, 240).webp({ lossless: true }).toBuffer()],
];

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

function expectStandardRetention(record: any, startedAt: number) {
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const retentionMs = new Date(record.expiresAt).getTime() - startedAt;
  expect(retentionMs).toBeGreaterThanOrEqual(threeDaysMs - 5000);
  expect(retentionMs).toBeLessThanOrEqual(threeDaysMs + 5000);
}

function compressRequest(level?: string) {
  const formData = new FormData();
  if (level !== undefined) {
    formData.set('level', level);
  }
  return new NextRequest('http://localhost:3000/api/convert/image-compress', {
    method: 'POST',
    body: formData,
  });
}

async function compressOne(bytes: Buffer, name: string, level?: string) {
  mockResolvedFiles = [fakeFile(bytes, name, 'application/octet-stream')];
  const res = await handleImageCompress(compressRequest(level));
  return { res, body: Buffer.from(await res.arrayBuffer()) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  compressImageMock.mockImplementation((...args: unknown[]) =>
    jest.requireActual('@/lib/image/compress').compressImage(...args)
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
    expect((await res.json()).error).toBe(
      'Image 1 is not a supported image type. Only JPEG, PNG and WebP images are accepted.',
    );
  });

  it('returns 400, not 500, for a corrupted image', async () => {
    mockResolvedFiles = [fakeFile(Buffer.from('\x89PNG\r\n\x1a\n rubbish rubbish rubbish', 'latin1'), 'broken.png')];

    const res = await handleImageCompress(compressRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Image 1 is damaged or incomplete and could not be read.');
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

  it('keeps serving the zip when the batch history write fails', async () => {
    mockUserId = '507f1f77bcf86cd799439011';
    const image = await createPng();
    mockResolvedFiles = [fakeFile(image, 'one.png'), fakeFile(image, 'two.png')];
    conversionCreate.mockRejectedValueOnce(new Error('mongo timeout'));

    const res = await handleImageCompress(compressRequest());

    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(['one.png', 'two.png']);
    expect(conversionCreate).toHaveBeenCalledTimes(1);
  });

  describe('output format', () => {
    it.each(PHOTOS)('returns a %s as %s named for it, whatever the upload claimed', async (_format, contentType, extension, createInput) => {
      const input = await createInput();
      const claimedName = extension === 'png' ? 'holiday.jpg' : 'holiday.png';

      const { res, body } = await compressOne(input, claimedName);

      expect(res.status).toBe(200);
      expect(magicFormat(body)).toBe(magicFormat(input));
      expect(res.headers.get('Content-Type')).toBe(contentType);
      expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="compressed_holiday.${extension}"; filename*=UTF-8''compressed_holiday.${extension}`);
    });

    it('names each zip entry for the format it really is', async () => {
      mockResolvedFiles = await Promise.all(
        PHOTOS.map(async ([, , , createInput], index) => fakeFile(await createInput(), `photo-${index}.gif`, 'image/gif')),
      );

      const res = await handleImageCompress(compressRequest());

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/zip');
      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
      expect(Object.keys(zip.files)).toEqual(['photo-0.jpg', 'photo-1.png', 'photo-2.webp']);
      for (const [name, entry] of Object.entries(zip.files)) {
        const expected = name.endsWith('.jpg') ? 'jpeg' : name.split('.').pop();
        expect(magicFormat(await entry.async('nodebuffer'))).toBe(expected);
      }
    });
  });

  describe('size', () => {
    it.each(PHOTOS)('reports the true sizes of a compressed %s', async (_format, _type, _extension, createInput) => {
      const input = await createInput();

      const { res, body } = await compressOne(input, 'photo');

      expect(body.length).toBeLessThan(input.length);
      expect(res.headers.get('X-Original-Size')).toBe(String(input.length));
      expect(res.headers.get('X-Compressed-Size')).toBe(String(body.length));
      expect(res.headers.get('X-Saved-Percent')).toBe(String(Math.round((1 - body.length / input.length) * 100)));
    });

    it.each([
      ['a 1x1 PNG', () => flatImage(1, 1).png().toBuffer()],
      ['an already optimised JPEG', () => createPhotoJpeg(320, 240, 40)],
      ['an already optimised WebP', () => photoLikePixels(320, 240).webp({ quality: 30 }).toBuffer()],
      ['a flat palette PNG', () => flatImage(200, 200).png({ palette: true, colours: 4 }).toBuffer()],
    ])('returns %s unchanged at every level when it cannot be made smaller, and says so', async (_label, createInput) => {
      const input = await createInput();

      for (const level of ['low', 'medium', 'high']) {
        const { res, body } = await compressOne(input, 'small', level);

        expect(body.length).toBeLessThanOrEqual(input.length);
        expect(res.headers.get('X-Original-Size')).toBe(String(input.length));
        expect(res.headers.get('X-Compressed-Size')).toBe(String(body.length));
        if (body.length === input.length) {
          expect(body.equals(input)).toBe(true);
          expect(res.headers.get('X-Saved-Percent')).toBe('0');
        }
      }
    });

    it('never returns a batch entry larger than its image', async () => {
      const images = await Promise.all([
        createPhotoJpeg(320, 240, 40),
        flatImage(1, 1).png().toBuffer(),
        photoLikePixels(320, 240).webp({ quality: 30 }).toBuffer(),
      ]);
      mockResolvedFiles = images.map((image, index) => fakeFile(image, `small-${index}`));

      const res = await handleImageCompress(compressRequest('low'));

      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
      const entries = await Promise.all(Object.values(zip.files).map((entry) => entry.async('nodebuffer')));
      entries.forEach((entry, index) => expect(entry.length).toBeLessThanOrEqual(images[index].length));
    });
  });

  describe('levels', () => {
    it('gives a photo three different sizes, smallest at high', async () => {
      const input = await createPhotoJpeg(320, 240, 100);

      const sizes = [];
      for (const level of ['low', 'medium', 'high']) {
        sizes.push((await compressOne(input, 'photo.jpg', level)).body.length);
      }

      expect(sizes[0]).toBeGreaterThan(sizes[1]);
      expect(sizes[1]).toBeGreaterThan(sizes[2]);
    });

    it.each([undefined, '', 'max', 'LOW', '60'])('treats level %p as medium', async (level) => {
      const input = await createPhotoJpeg(320, 240, 100);

      const medium = (await compressOne(input, 'photo.jpg', 'medium')).body;
      const other = (await compressOne(input, 'photo.jpg', level)).body;

      expect(other.equals(medium)).toBe(true);
    });
  });

  describe('input', () => {
    it.each([
      ['an SVG with many elements', async () => createSvgWithManyElements()],
      ['an SVG that takes minutes to render', async () => Buffer.from(createSvgThatTakesMinutesToRender(8000))],
      ['a GIF', () => flatImage().gif().toBuffer()],
      ['a TIFF', () => flatImage().tiff().toBuffer()],
    ])('refuses %s named .png without asking sharp about it', async (_label, createUpload) => {
      const upload = await createUpload();

      const { res, body } = await compressOne(upload, 'picture.png');

      expect(res.status).toBe(400);
      expect(JSON.parse(body.toString()).error).toBe(
        'Image 1 is not a supported image type. Only JPEG, PNG and WebP images are accepted.',
      );
      expect(wasGivenToSharp(upload)).toBe(false);
    });

    it('compresses a normal image straight after refusing the slow SVG', async () => {
      expect((await compressOne(Buffer.from(createSvgThatTakesMinutesToRender(8000)), 'slow.png')).res.status).toBe(400);

      const { res, body } = await compressOne(await createPhotoJpeg(320, 240, 100), 'photo.jpg');

      expect(res.status).toBe(200);
      expect(magicFormat(body)).toBe('jpeg');
    });

    it.each([
      ['an animated WebP', createAnimatedWebp],
      ['an animated PNG', async () => createAnimatedPng()],
    ])('refuses %s', async (_label, createUpload) => {
      const { res, body } = await compressOne(await createUpload(), 'moving');

      expect(res.status).toBe(400);
      expect(JSON.parse(body.toString()).error).toBe('Image 1 is animated. Animated images are not supported.');
    });

    it('refuses a whole batch for one bad image, naming it, before compressing any', async () => {
      const photo = await createPhotoJpeg();
      mockResolvedFiles = [
        fakeFile(photo, 'one.jpg'),
        fakeFile(photo, 'two.jpg'),
        fakeFile(createSvgWithManyElements(), 'three.png'),
      ];

      const res = await handleImageCompress(compressRequest());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        'Image 3 is not a supported image type. Only JPEG, PNG and WebP images are accepted.',
      );
      expect(compressImageMock).not.toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('records a single compression as history-only: no stored output', async () => {
      mockUserId = '507f1f77bcf86cd799439011';
      const image = await createPng();
      mockResolvedFiles = [fakeFile(image)];
      const startedAt = Date.now();

      const res = await handleImageCompress(compressRequest());
      const body = Buffer.from(await res.arrayBuffer());

      expect(conversionCreate).toHaveBeenCalledTimes(1);
      const record = conversionCreate.mock.calls[0][0];
      expect(record).toMatchObject({
        toolUsed: 'Compress Image',
        fileName: 'pic.png',
        fileSize: image.length,
        status: 'Completed',
        metadata: { pages: 1, processedSize: body.length },
      });
      expect(record.outputUrl).toBeUndefined();
      expect(record.diskFileName).toBeUndefined();
      expectStandardRetention(record, startedAt);
      expect(mockStoragePut).not.toHaveBeenCalled();
    });

    it('records a batch compression as history-only: no stored output', async () => {
      mockUserId = '507f1f77bcf86cd799439011';
      const image = await createPng();
      mockResolvedFiles = [fakeFile(image, 'one.png'), fakeFile(image, 'two.png')];
      const startedAt = Date.now();

      const res = await handleImageCompress(compressRequest());
      const body = Buffer.from(await res.arrayBuffer());

      expect(conversionCreate).toHaveBeenCalledTimes(1);
      const record = conversionCreate.mock.calls[0][0];
      expect(record).toMatchObject({
        toolUsed: 'Compress Image (Batch)',
        fileName: 'compressed_images.zip',
        fileSize: image.length * 2,
        status: 'Completed',
        metadata: { pages: 2, processedSize: body.length },
      });
      expect(record.outputUrl).toBeUndefined();
      expect(record.diskFileName).toBeUndefined();
      expectStandardRetention(record, startedAt);
      expect(mockStoragePut).not.toHaveBeenCalled();
    });
  });

  describe('zip entry names for a batch', () => {
    const hostileNames = [
      '../../evil.png',
      '..\\..\\evil.png',
      '/etc/cron.d/evil.png',
      'C:\\Windows\\evil.png',
      'evil.png',
      'EVIL.png',
      '',
      '../..',
    ];

    it('uses bare, unique basenames so extracting the archive cannot escape its folder', async () => {
      mockUserId = '507f1f77bcf86cd799439011';
      mockPlan = 'Pro';
      const image = await createPng();
      mockResolvedFiles = hostileNames.map((name) => fakeFile(image, name));

      const res = await handleImageCompress(compressRequest());

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/zip');
      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
      const entries = Object.values(zip.files);

      expect(entries).toHaveLength(hostileNames.length);
      for (const entry of entries) {
        expect(entry.dir).toBe(false);
        expect(entry.name).not.toMatch(/[\\/:]/);
        expect(entry.name).not.toMatch(/^\.+$/);
        expect(entry.name.length).toBeGreaterThan(0);
      }
      expect(new Set(entries.map((e) => e.name.toLowerCase())).size).toBe(hostileNames.length);
      expect(entries.map((e) => e.name)).toEqual(expect.arrayContaining(['evil.png', 'evil (1).png', 'evil (2).png', 'image-7.png', 'image-8.png']));
    });

    it('leaves ordinary distinct names untouched', async () => {
      mockUserId = '507f1f77bcf86cd799439011';
      mockPlan = 'Pro';
      const image = await createPng();
      mockResolvedFiles = [fakeFile(image, 'one.png'), fakeFile(image, 'two.png')];

      const res = await handleImageCompress(compressRequest());

      const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
      expect(Object.keys(zip.files).sort()).toEqual(['one.png', 'two.png']);
    });
  });
});
