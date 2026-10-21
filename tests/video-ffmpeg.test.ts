import { FfmpegExitError, FfmpegStoppedError, runFfmpeg } from '../lib/video/ffmpeg';
import { trackSpawnedProcesses } from './helpers/videoSamples';

jest.setTimeout(60_000);

// A test pattern with no end: it runs until something stops it.
const ENDLESS = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'null', '-'];

let processes: ReturnType<typeof trackSpawnedProcesses>;

beforeEach(() => {
  processes = trackSpawnedProcesses();
});

afterEach(() => {
  processes.restore();
  expect(processes.stillRunning()).toEqual([]);
});

describe('runFfmpeg', () => {
  it('resolves with the log of a run that succeeds', async () => {
    const log = await runFfmpeg({
      args: ['-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=1', '-f', 'null', '-'],
      deadlineMs: 30_000,
    });

    expect(log).toMatch(/Input #0, lavfi/);
  });

  it('rejects with the end of the log when ffmpeg fails', async () => {
    const error = await runFfmpeg({ args: ['-i', 'no-such-input.mp4', '-f', 'null', '-'], deadlineMs: 30_000 }).catch((e) => e);

    expect(error).toBeInstanceOf(FfmpegExitError);
    expect(error.exitCode).not.toBe(0);
    expect(error.stderr).toMatch(/No such file or directory/);
  });

  it('kills ffmpeg at its deadline and settles only once it has exited', async () => {
    const error = await runFfmpeg({ args: ENDLESS, deadlineMs: 300 }).catch((e) => e);

    expect(error).toBeInstanceOf(FfmpegStoppedError);
    expect(error.reason).toBe('deadline');
    expect(processes.spawned).toHaveLength(1);
    expect(processes.spawned[0].child.exitCode !== null || processes.spawned[0].child.signalCode !== null).toBe(true);
  });

  it('kills ffmpeg when the signal aborts', async () => {
    const controller = new AbortController();
    const running = runFfmpeg({ args: ENDLESS, deadlineMs: 60_000, signal: controller.signal }).catch((e) => e);
    while (processes.spawned.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    controller.abort();
    const error = await running;

    expect(error).toBeInstanceOf(FfmpegStoppedError);
    expect(error.reason).toBe('aborted');
  });

  it('does not start ffmpeg for a request that was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await runFfmpeg({ args: ENDLESS, deadlineMs: 60_000, signal: controller.signal }).catch((e) => e);

    expect(error).toBeInstanceOf(FfmpegStoppedError);
    expect(processes.spawned).toEqual([]);
  });

  it('keeps only both ends of a very long log', async () => {
    const log = await runFfmpeg({
      // -debug_ts logs every packet and frame: about 1 MB for these 750 frames.
      args: ['-debug_ts', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=30', '-f', 'null', '-'],
      deadlineMs: 30_000,
    });

    expect(log.length).toBeLessThanOrEqual(64 * 1024 + 8 * 1024 + 16);
    expect(log).toMatch(/\[\.\.\.\]/);
    expect(log).toMatch(/Input #0, lavfi/);
    // FFmpeg 6 (the Windows build) writes kB, FFmpeg 7 (the Linux build) KiB.
    expect(log.slice(-8 * 1024)).toMatch(/video:\d+(?:kB|KiB)/);
  });
});
