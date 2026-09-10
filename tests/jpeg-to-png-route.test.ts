import { NextRequest } from 'next/server';
import sharp from 'sharp';

jest.mock('@/lib/image/to-png', () => ({
  convertJpegToPng: jest.fn((opts: any) => jest.requireActual('@/lib/image/to-png').convertJpegToPng(opts)),
}));

import { POST as handleJpegToPng } from '../app/api/convert/jpeg-to-png/route';
import { convertJpegToPng } from '@/lib/image/to-png';

const convertJpegToPngMock = convertJpegToPng as jest.Mock;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function createJpeg(size = 40): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();
}

function jpegRequest(buffer?: Buffer, name = 'pic.jpg') {
  const body = new FormData();
  if (buffer) {
    body.append('image', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), name);
  }
  return new NextRequest('http://localhost:3000/api/convert/jpeg-to-png', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  convertJpegToPngMock.mockImplementation((opts: any) =>
    jest.requireActual('@/lib/image/to-png').convertJpegToPng(opts)
  );
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('jpeg-to-png route error handling', () => {
  it('converts a valid JPEG: 200, png body', async () => {
    const res = await handleJpegToPng(jpegRequest(await createJpeg()));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('returns the converted PNG byte-for-byte unchanged', async () => {
    const expected = Buffer.concat([PNG_SIGNATURE, Buffer.from('stub-png-payload')]);
    convertJpegToPngMock.mockResolvedValueOnce(expected);

    const res = await handleJpegToPng(jpegRequest(await createJpeg()));

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(expected)).toBe(true);
  });

  it('returns 400 when no file is provided', async () => {
    const res = await handleJpegToPng(jpegRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No JPEG image file provided.');
  });

  it('returns 400, not 500, for a 0-byte file', async () => {
    const res = await handleJpegToPng(jpegRequest(Buffer.alloc(0)));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it('returns 400, not 500, for a non-image upload', async () => {
    const res = await handleJpegToPng(jpegRequest(Buffer.from('this is definitely not an image'), 'notes.txt'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid image/i);
  });

  it('returns 400, not 500, for a corrupted image', async () => {
    const res = await handleJpegToPng(jpegRequest(Buffer.from('\xff\xd8\xff rubbish rubbish rubbish'), 'broken.jpg'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid image/i);
  });

  it('still returns 500 for a genuine server fault', async () => {
    convertJpegToPngMock.mockRejectedValueOnce(new Error('sharp: worker pool crashed'));

    const res = await handleJpegToPng(jpegRequest(await createJpeg()));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to convert JPEG to PNG.');
  });

  // This route intentionally performs no history write (see issue #48 scope note:
  // its missing auth/user check is a separate concern), so there is no
  // saveConversionRecord path that could turn into a 500.
});
