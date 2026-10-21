import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { compressVideo, outputDimensions } from '../lib/video/compress';
import { ClientError } from '../lib/convert/errors';
import { X264_PRESET } from '../lib/convert/video-compress-limits';
import * as ffmpegRunner from '../lib/video/ffmpeg';
import { FfmpegExitError } from '../lib/video/ffmpeg';
import { makeVideo, trackSpawnedProcesses } from './helpers/videoSamples';

jest.setTimeout(120_000);

const GENEROUS_LIMITS = { maxDurationSeconds: 3600, encodeDeadlineMs: 120_000 };

let sampleVideo: Buffer;
// Long enough at its size that an encode is still running when the test stops it.
let slowVideo: Buffer;

beforeAll(() => {
  sampleVideo = makeVideo({ size: '128x96', rate: 12, seconds: 1 });
  slowVideo = makeVideo({ size: '1280x720', rate: 30, seconds: 60, crf: 30, extra: ['-preset', 'ultrafast'] });
});

let processes: ReturnType<typeof trackSpawnedProcesses>;

beforeEach(() => {
  processes = trackSpawnedProcesses();
});

afterEach(() => {
  jest.restoreAllMocks();
  expect(processes.stillRunning()).toEqual([]);
  expect(processes.leftoverTempFiles()).toEqual([]);
});

describe('compressVideo (lib/video/compress.ts)', () => {
  it('re-encodes a real video into an MP4', async () => {
    const result = await compressVideo({ inputBuffer: makeVideo({ seconds: 1, crf: 0 }), fileName: 'sample.mp4', crf: 32, ...GENEROUS_LIMITS });

    expect(result.compressed).toBe(true);
    expect(result.format).toEqual({ extension: 'mp4', contentType: 'video/mp4' });
    expect(result.bytes.subarray(0, 12).toString('latin1')).toContain('ftyp');
  });

  it('rejects a 0-byte upload as a client error without invoking ffmpeg', async () => {
    const error = await compressVideo({ inputBuffer: Buffer.alloc(0), fileName: 'empty.mp4', crf: 28, ...GENEROUS_LIMITS }).catch((e) => e);

    expect(error).toBeInstanceOf(ClientError);
    expect(error.status).toBe(400);
    expect(processes.spawned).toEqual([]);
  });

  it('maps a non-video / corrupt input to a 400 client error', async () => {
    const garbage = Buffer.from('this is definitely not a video file, just plain text');

    const error = await compressVideo({ inputBuffer: garbage, fileName: 'notes.txt', crf: 28, ...GENEROUS_LIMITS }).catch((e) => e);

    expect(error).toBeInstanceOf(ClientError);
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/could not be read as a video/i);
  });

  it('maps a truncated video to a 400 client error', async () => {
    const truncated = sampleVideo.subarray(0, Math.floor(sampleVideo.length / 3));

    const error = await compressVideo({ inputBuffer: truncated, fileName: 'cut.mp4', crf: 28, ...GENEROUS_LIMITS }).catch((e) => e);

    expect(error).toBeInstanceOf(ClientError);
  });

  it('treats an input the server failed to hand to ffmpeg as a server fault', async () => {
    jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

    const error = await compressVideo({ inputBuffer: sampleVideo, fileName: 'clip.mp4', crf: 28, ...GENEROUS_LIMITS }).catch((e) => e);

    expect(error).toBeInstanceOf(FfmpegExitError);
    expect(error).not.toBeInstanceOf(ClientError);
    expect(error.stderr).toMatch(/No such file or directory/);
  });

  it("treats an encode failure ffmpeg reports as 'Invalid argument' as a server fault", async () => {
    const realRun = ffmpegRunner.runFfmpeg;
    jest.spyOn(ffmpegRunner, 'runFfmpeg').mockImplementation((run) =>
      run.args.includes('libx264')
        ? Promise.reject(new FfmpegExitError(1, 'Error initializing a simple filtergraph\nError opening output files: Invalid argument'))
        : realRun(run),
    );

    const error = await compressVideo({ inputBuffer: sampleVideo, fileName: 'clip.mp4', crf: 28, ...GENEROUS_LIMITS }).catch((e) => e);

    expect(error).toBeInstanceOf(FfmpegExitError);
    expect(error).not.toBeInstanceOf(ClientError);
  });

  it('kills ffmpeg and removes its temp files when the deadline passes', async () => {
    const error = await compressVideo({
      inputBuffer: slowVideo,
      fileName: 'long.mp4',
      crf: 28,
      maxDurationSeconds: 3600,
      encodeDeadlineMs: 500,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ClientError);
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/could not be compressed in time/i);
    expect(processes.encodes()).toHaveLength(1);
  });

  it('kills ffmpeg and removes its temp files when the request is aborted', async () => {
    const controller = new AbortController();
    const compressing = compressVideo({
      inputBuffer: slowVideo,
      fileName: 'long.mp4',
      crf: 28,
      ...GENEROUS_LIMITS,
      signal: controller.signal,
    }).catch((e) => e);

    const encode = await processes.untilEncodeStarted();
    controller.abort();
    const error = await compressing;

    expect(error).toBeInstanceOf(ClientError);
    expect(error.message).toMatch(/cancelled/i);
    expect(encode.exitCode !== null || encode.signalCode !== null).toBe(true);
  });

  it('encodes with the chosen x264 preset', async () => {
    await compressVideo({ inputBuffer: sampleVideo, fileName: 'clip.mp4', crf: 28, ...GENEROUS_LIMITS });

    const [encode] = processes.encodes();
    expect(encode.args[encode.args.indexOf('-preset') + 1]).toBe(X264_PRESET);
  });

  describe('client-supplied file names never reach the filesystem', () => {
    const tempRoot = path.resolve(tmpdir());
    const isInsideTemp = (target: string) => path.dirname(path.resolve(target)) === tempRoot;
    let touchedPaths: string[];

    beforeEach(() => {
      touchedPaths = [];
      const realWriteFile = fs.promises.writeFile;
      const realRm = fs.promises.rm;
      // Only paths inside the temp dir are passed through, so a regression can never
      // write or delete a real file elsewhere on the machine running the suite.
      jest.spyOn(fs.promises, 'writeFile').mockImplementation((async (target: string, ...rest: unknown[]) => {
        touchedPaths.push(String(target));
        if (isInsideTemp(String(target))) await (realWriteFile as (...args: unknown[]) => Promise<void>)(target, ...rest);
      }) as typeof fs.promises.writeFile);
      jest.spyOn(fs.promises, 'rm').mockImplementation((async (target: string, options?: fs.RmOptions) => {
        touchedPaths.push(String(target));
        if (isInsideTemp(String(target))) await realRm(target, options);
      }) as typeof fs.promises.rm);
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
      const result = await compressVideo({ inputBuffer: sampleVideo, fileName, crf: 32, ...GENEROUS_LIMITS });

      expect(result.bytes.length).toBeGreaterThan(0);
      expect(touchedPaths.length).toBeGreaterThanOrEqual(3);
      for (const touched of touchedPaths) {
        expect(isInsideTemp(touched)).toBe(true);
        expect(path.basename(touched)).toMatch(/^(input|output)-[0-9a-f-]{36}\.[a-z0-9]{1,4}$/);
      }
    });
  });
});

describe('outputDimensions', () => {
  it.each([
    [320, 240, '720p', 320, 240],
    [1280, 720, '480p', 854, 480],
    [720, 1280, '480p', 480, 854],
    [1920, 1080, '720p', 1280, 720],
    [1080, 1920, '720p', 720, 1280],
    [3840, 2160, '480p', 854, 480],
    [721, 1281, '720p', 720, 1280],
    [321, 241, 'Original', 320, 240],
    [1, 1, 'Original', 2, 2],
    [1920, 1080, 'Original', 1920, 1080],
    [1920, 1080, 'something else', 1920, 1080],
  ])('%ix%i at %s is %ix%i', (width, height, resolution, expectedWidth, expectedHeight) => {
    expect(outputDimensions(width, height, resolution)).toEqual({ width: expectedWidth, height: expectedHeight });
  });
});
