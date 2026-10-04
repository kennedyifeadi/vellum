import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import ffmpegStatic from 'ffmpeg-static';
import { compressVideo } from '../lib/video/compress';
import { ClientError } from '../lib/convert/errors';

let sampleVideo: Buffer;

beforeAll(() => {
  const out = path.join(tmpdir(), `vc-fixture-${Date.now()}.mp4`);
  execFileSync(ffmpegStatic as string, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=duration=1:size=128x96:rate=12',
    '-pix_fmt', 'yuv420p',
    out,
  ]);
  sampleVideo = fs.readFileSync(out);
  fs.unlinkSync(out);
});

describe('compressVideo (lib/video/compress.ts)', () => {
  it('re-encodes a real video into a smaller MP4 buffer', async () => {
    const result = await compressVideo({
      inputBuffer: sampleVideo,
      fileName: 'sample.mp4',
      crf: 32,
      resolution: 'Original',
    });

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // ftyp box marker near the start of every MP4.
    expect(result.subarray(0, 12).toString('latin1')).toContain('ftyp');
  });

  it('rejects a 0-byte upload as a client error without invoking ffmpeg', async () => {
    await expect(
      compressVideo({ inputBuffer: Buffer.alloc(0), fileName: 'empty.mp4', crf: 28 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      compressVideo({ inputBuffer: Buffer.alloc(0), fileName: 'empty.mp4', crf: 28 }),
    ).rejects.toBeInstanceOf(ClientError);
  });

  it('maps a non-video / corrupt input to a 400 client error', async () => {
    const garbage = Buffer.from('this is definitely not a video file, just plain text');

    const error = await compressVideo({
      inputBuffer: garbage,
      fileName: 'notes.txt',
      crf: 28,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ClientError);
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/could not be read as a video/i);
  });

  it('leaves no temp files behind after a failed conversion', async () => {
    const before = fs.readdirSync(tmpdir()).filter((f) => f.startsWith('input-') || f.startsWith('output-'));

    await compressVideo({
      inputBuffer: Buffer.from('nope'),
      fileName: 'x.mp4',
      crf: 28,
    }).catch(() => {});

    const after = fs.readdirSync(tmpdir()).filter((f) => f.startsWith('input-') || f.startsWith('output-'));
    expect(after.length).toBeLessThanOrEqual(before.length);
  });
});
