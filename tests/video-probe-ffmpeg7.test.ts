// The Linux ffmpeg that ffmpeg-static installs is FFmpeg 7.0.2, the Windows one 6.1.1. This
// replays what 7.0.2 printed (in CI) when probing a raw H.264 stream of 200 frames at 10 fps,
// so the probe is checked against it on every platform.
const mockRunFfmpeg = jest.fn();

jest.mock('@/lib/video/ffmpeg', () => ({
  ...jest.requireActual('@/lib/video/ffmpeg'),
  runFfmpeg: (run: unknown) => mockRunFfmpeg(run),
}));

import { probeVideo } from '@/lib/video/probe';

const FFMPEG_7_LOG = `Input #0, h264, from '/tmp/input.tmp':
  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: h264 (High), yuv420p(progressive), 64x64 [SAR 1:1 DAR 1:1], 25 fps, 20 tbr, 1200k tbn
Stream mapping:
  Stream #0:0 -> #0:0 (copy)
Output #0, framecrc, to 'pipe:1':
  Stream #0:0: Video: h264 (High), yuv420p(progressive), 64x64 [SAR 1:1 DAR 1:1], q=2-31, 25 fps, 20 tbr, 1200k tbn
[out#0/framecrc @ 0x34206d40] video:87KiB audio:0KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
size=      15KiB time=N/A bitrate=N/A speed=N/A
`;

// framecrc's value for an unset presentation time.
const UNSET_PTS = '-9223372036854775808';

function framecrc(frames: number): string {
  const header = '#extradata 0:       37, 0x93720979\n#software: Lavf61.1.100\n#tb 0: 1/1200000\n#media_type 0: video\n';
  const packets = Array.from(
    { length: frames },
    (_, i) => `0, ${-96000 + i * 120000}, ${UNSET_PTS}, 120000, 300, 0x2b719e73${i ? ', F=0x0' : ''}\n`,
  );
  return header + packets.join('');
}

describe('probeVideo with FFmpeg 7 output', () => {
  it('measures a headerless stream from its packets when the final report has no time', async () => {
    mockRunFfmpeg.mockImplementation(async ({ onStdout }: { onStdout: (chunk: string) => void }) => {
      const output = framecrc(200);
      // Split mid-line, as a pipe may.
      onStdout(output.slice(0, 1000));
      onStdout(output.slice(1000));
      return FFMPEG_7_LOG;
    });

    const result = await probeVideo('/tmp/input.tmp', { deadlineMs: 1000 });

    expect(result.durationSeconds).toBeCloseTo(19.92, 2);
    expect(result.video?.frameCount).toBe(200);
  });

  it('reports no length when no packet was copied', async () => {
    mockRunFfmpeg.mockResolvedValue(FFMPEG_7_LOG);

    const result = await probeVideo('/tmp/input.tmp', { deadlineMs: 1000 });

    expect(result.durationSeconds).toBe(0);
    expect(result.video?.frameCount).toBe(0);
  });
});
