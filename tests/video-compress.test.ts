import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { compressVideo, outputDimensions } from '../lib/video/compress';
import { ClientError } from '../lib/convert/errors';
import { X264_PRESET } from '../lib/convert/video-compress-limits';
import * as ffmpegRunner from '../lib/video/ffmpeg';
import { FfmpegExitError } from '../lib/video/ffmpeg';
import { inspect, makeMedia, makeVideo, remux, trackSpawnedProcesses } from './helpers/videoSamples';

jest.setTimeout(120_000);

// Lets every video through the estimate, so these tests reach the encode on any machine.
const FREE_ENCODES = { encodeSecondsPerMegapixelFrame: 0, decodeSecondsPerMegapixelFrame: 0, safetyFactor: 1 };
const GENEROUS_LIMITS = { maxDurationSeconds: 3600, timeBudgetMs: 120_000, encodeCost: FREE_ENCODES };

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

  it('kills ffmpeg and removes its temp files when the time budget runs out', async () => {
    const error = await compressVideo({
      inputBuffer: slowVideo,
      fileName: 'long.mp4',
      crf: 28,
      maxDurationSeconds: 3600,
      timeBudgetMs: 5_000,
      encodeCost: FREE_ENCODES,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ClientError);
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/could not be compressed in time/i);
    expect(processes.encodes()).toHaveLength(1);
  });

  it.each([
    ['a long budget', 60_000, [30_000, 57_000]],
    ['a budget shorter than the probe deadline', 20_000, [20_000, 17_000]],
  ])('gives the encode what the probe left of %s', async (_label, timeBudgetMs, expectedDeadlines) => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const realRun = ffmpegRunner.runFfmpeg;
    const deadlines: number[] = [];
    jest.spyOn(ffmpegRunner, 'runFfmpeg').mockImplementation(async (run) => {
      deadlines.push(run.deadlineMs);
      const log = await realRun(run);
      now += 3_000;
      return log;
    });

    await compressVideo({ inputBuffer: sampleVideo, fileName: 'clip.mp4', crf: 28, ...GENEROUS_LIMITS, timeBudgetMs });

    expect(deadlines).toEqual(expectedDeadlines);
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

  describe('refuses before encoding a video whose encode would not fit in the time budget', () => {
    // The budget is generous for these small clips; the injected costs decide what fits.
    const budget = { maxDurationSeconds: 3600, timeBudgetMs: 150_000 };
    const cost = (encode: number, decode = 0) => ({
      encodeSecondsPerMegapixelFrame: encode,
      decodeSecondsPerMegapixelFrame: decode,
      safetyFactor: 1,
    });
    // 60 frames of 1280x720: 221 s encoded at that size, 129 s at 480p (854x480).
    const HD_COST = cost(3, 1);
    let hd: Buffer;

    beforeAll(() => {
      hd = makeVideo({ size: '1280x720', rate: 30, seconds: 2 });
    });

    it('refuses a 720p video at its own size, naming how long one can be and the 480p option', async () => {
      const error = await compressVideo({ inputBuffer: hd, fileName: 'hd.mp4', crf: 28, ...budget, encodeCost: HD_COST }).catch((e) => e);

      expect(error).toBeInstanceOf(ClientError);
      expect(error.status).toBe(400);
      expect(error.message).toBe(
        'This video would take too long to compress. Videos at this resolution and frame rate can be up to about 1 second long; choose 480p or a shorter clip.',
      );
      expect(processes.spawned).toHaveLength(1);
      expect(processes.encodes()).toEqual([]);
    });

    it('accepts the same video at 480p', async () => {
      const result = await compressVideo({ inputBuffer: hd, fileName: 'hd.mp4', crf: 28, resolution: '480p', ...budget, encodeCost: HD_COST });

      expect(inspect(result.bytes).video).toMatchObject({ width: 854, height: 480 });
      expect(processes.encodes()).toHaveLength(1);
    });

    it('suggests no lower resolution when none would make the output smaller', async () => {
      const error = await compressVideo({
        inputBuffer: hd,
        fileName: 'hd.mp4',
        crf: 28,
        resolution: '480p',
        ...budget,
        encodeCost: cost(10),
      }).catch((e) => e);

      expect(error.message).toMatch(/; choose a shorter clip\.$/);
      expect(processes.encodes()).toEqual([]);
    });

    it('counts every frame of a high-frame-rate video', async () => {
      // 0.0768 MP a frame at 10 s per MP: 46 s for 60 frames, 92 s for 120.
      const options = { fileName: 'clip.mp4', crf: 28, maxDurationSeconds: 3600, timeBudgetMs: 60_000, encodeCost: cost(10) };
      const thirty = makeVideo({ size: '320x240', rate: 30, seconds: 2 });
      const sixty = makeVideo({ size: '320x240', rate: 60, seconds: 2 });

      await compressVideo({ inputBuffer: thirty, ...options });
      const error = await compressVideo({ inputBuffer: sixty, ...options }).catch((e) => e);

      expect(error).toBeInstanceOf(ClientError);
      expect(error.message).toMatch(/too long to compress/);
      expect(processes.encodes()).toHaveLength(1);
    });

    it('counts the frames ffmpeg repeats to fill out a variable-rate video', async () => {
      // 72 frames in 4 s at a base rate of 60, which ffmpeg encodes as 240.
      const variable = makeMedia([
        '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=60:duration=4',
        '-vf', "select='lt(mod(n,60),10)+not(mod(n,6))'", '-fps_mode', 'vfr', '-c:v', 'libx264',
      ]);

      // 0.0768 MP a frame at 5 s per MP: 28 s for 72 frames, 92 s for 240.
      const error = await compressVideo({
        inputBuffer: variable,
        fileName: 'vfr.mp4',
        crf: 28,
        maxDurationSeconds: 3600,
        timeBudgetMs: 60_000,
        encodeCost: cost(5),
      }).catch((e) => e);

      expect(error).toBeInstanceOf(ClientError);
      expect(error.message).toMatch(/too long to compress/);
      expect(processes.encodes()).toEqual([]);
    });

    it('sizes a rotated portrait video by its upright shape at the chosen resolution', async () => {
      const portrait = remux(hd, ['-display_rotation', '90'], ['-c', 'copy']);
      const options = { inputBuffer: portrait, fileName: 'phone.mp4', crf: 28, ...budget, encodeCost: HD_COST };

      const refused = await compressVideo(options).catch((e) => e);
      const result = await compressVideo({ ...options, resolution: '480p' });

      expect(refused.message).toMatch(/choose 480p or a shorter clip/);
      expect(inspect(result.bytes).video).toMatchObject({ width: 480, height: 854 });
      expect(processes.encodes()).toHaveLength(1);
    });
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
