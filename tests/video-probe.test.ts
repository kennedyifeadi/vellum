import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { FfmpegExitError, FfmpegStoppedError } from '../lib/video/ffmpeg';
import { probeVideo } from '../lib/video/probe';
import { makeMedia, makeVideo, remux, trackSpawnedProcesses } from './helpers/videoSamples';

jest.setTimeout(60_000);

const OPTIONS = { deadlineMs: 30_000 };

async function probe(bytes: Buffer, extension = 'mp4', options = OPTIONS) {
  const file = path.join(tmpdir(), `vc-probe-${randomUUID()}.${extension}`);
  fs.writeFileSync(file, bytes);
  try {
    return await probeVideo(file, options);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

let processes: ReturnType<typeof trackSpawnedProcesses>;

beforeEach(() => {
  processes = trackSpawnedProcesses();
});

afterEach(() => {
  processes.restore();
  expect(processes.stillRunning()).toEqual([]);
});

describe('probeVideo', () => {
  it('reads the container, size, frames and length of a video', async () => {
    const result = await probe(makeVideo({ size: '320x240', rate: 10, seconds: 3 }));

    expect(result.container).toMatch(/^mov,mp4/);
    expect(result.majorBrand).toBe('isom');
    expect(result.video).toEqual({ width: 320, height: 240, rotation: 0, frameCount: 30 });
    expect(result.durationSeconds).toBeCloseTo(3, 1);
    expect(result.audioStreamCount).toBe(0);
  });

  it('measures the length of a stream whose header has none', async () => {
    const raw = makeMedia(['-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=20', '-c:v', 'libx264'], 'h264');

    const result = await probe(raw, 'tmp');

    expect(result.durationSeconds).toBeGreaterThan(19);
    expect(result.video?.frameCount).toBe(200);
  });

  it('reads the rotation of a phone clip', async () => {
    const phone = remux(makeVideo({ seconds: 1 }), ['-display_rotation', '90'], ['-c', 'copy']);

    const result = await probe(phone);

    expect(Math.abs(result.video!.rotation)).toBe(90);
  });

  it('counts every audio stream', async () => {
    const input = makeMedia(
      [
        '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=1',
        '-f', 'lavfi', '-i', 'sine=duration=1',
        '-f', 'lavfi', '-i', 'sine=frequency=660:duration=1',
        '-map', '0', '-map', '1', '-map', '2', '-c:v', 'libx264',
      ],
      'mkv',
    );

    const result = await probe(input, 'mkv');

    expect(result.audioStreamCount).toBe(2);
    expect(result.container).toBe('matroska,webm');
  });

  it('finds no video in audio, even with cover art', async () => {
    const cover = path.join(tmpdir(), `vc-cover-${randomUUID()}.png`);
    fs.writeFileSync(cover, makeMedia(['-f', 'lavfi', '-i', 'testsrc2=size=64x64', '-frames:v', '1'], 'png'));
    try {
      const song = makeMedia(
        ['-f', 'lavfi', '-i', 'sine=duration=2', '-i', cover, '-map', '0', '-map', '1', '-c:v', 'png', '-disposition:v', 'attached_pic'],
        'mp3',
      );

      const result = await probe(song, 'tmp');

      expect(result.video).toBeNull();
      expect(result.audioStreamCount).toBe(1);
    } finally {
      fs.rmSync(cover, { force: true });
    }
  });

  it('counts one frame in a still image', async () => {
    const still = makeMedia(['-f', 'lavfi', '-i', 'testsrc2=size=64x64', '-frames:v', '1'], 'png');

    const result = await probe(still, 'tmp');

    expect(result.video?.frameCount).toBe(1);
  });

  it('rejects an input ffmpeg cannot open', async () => {
    const error = await probe(Buffer.from('not a video')).catch((e) => e);

    expect(error).toBeInstanceOf(FfmpegExitError);
    expect(error.stderr).toMatch(/Invalid data found when processing input/);
  });

  it('is stopped at its own deadline', async () => {
    const error = await probe(makeVideo({ size: '64x64', rate: 25, seconds: 600, crf: 51 }), 'mp4', { deadlineMs: 1 }).catch((e) => e);

    expect(error).toBeInstanceOf(FfmpegStoppedError);
    expect(error.reason).toBe('deadline');
  });
});
