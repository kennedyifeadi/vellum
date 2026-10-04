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

  describe('client-supplied file names never reach the filesystem', () => {
    const tempRoot = path.resolve(tmpdir());
    const realWriteFileSync = fs.writeFileSync;
    const realUnlinkSync = fs.unlinkSync;
    let touchedPaths: string[];

    const isInsideTemp = (target: string) => path.dirname(path.resolve(target)) === tempRoot;

    beforeEach(() => {
      touchedPaths = [];
      // Only paths inside the temp dir are passed through, so a regression can never
      // write or delete a real file elsewhere on the machine running the suite.
      jest.spyOn(fs, 'writeFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
        touchedPaths.push(String(target));
        if (isInsideTemp(String(target))) {
          (realWriteFileSync as (...args: unknown[]) => void)(target, ...rest);
        }
      }) as typeof fs.writeFileSync);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(((target: fs.PathLike) => {
        touchedPaths.push(String(target));
        if (isInsideTemp(String(target))) realUnlinkSync(target);
      }) as typeof fs.unlinkSync);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each([
      ['POSIX traversal', '../../x.mp4'],
      ['deep POSIX traversal', '../../../../../../../../x.mp4'],
      ['Windows traversal', '..\\..\\x.mp4'],
      ['deep Windows traversal', '..\\..\\..\\..\\..\\..\\..\\..\\Users\\Public\\pwned.mp4'],
      ['POSIX absolute path', '/etc/passwd.mp4'],
      ['Windows absolute path', 'C:\\Windows\\win.mp4'],
      ['empty name', ''],
      ['separators only', '/\\/\\'],
      ['hostile extension', 'clip.mp4/../../../../x'],
    ])('keeps every temp file inside the temp dir for a %s', async (_label, fileName) => {
      const result = await compressVideo({ inputBuffer: sampleVideo, fileName, crf: 32 });

      expect(result.subarray(0, 12).toString('latin1')).toContain('ftyp');
      expect(touchedPaths.length).toBeGreaterThanOrEqual(3);
      for (const touched of touchedPaths) {
        expect(isInsideTemp(touched)).toBe(true);
        expect(path.basename(touched)).toMatch(/^(input|output)-[0-9a-f-]{36}\.[a-z0-9]{1,4}$/);
      }
    });
  });
});
