import { FfmpegExitError, runFfmpeg } from '@/lib/video/ffmpeg';

export interface VideoProbe {
  /** ffmpeg's name for the container, e.g. `mov,mp4,m4a,3gp,3g2,mj2` or `matroska,webm`. */
  container: string;
  /** The QuickTime-family brand, which tells MP4, MOV and 3GP apart. */
  majorBrand: string | null;
  durationSeconds: number;
  /** The first video stream that is not cover art, as stored (before rotation). */
  video: { width: number; height: number; rotation: number; frameCount: number } | null;
  audioStreamCount: number;
}

// The defaults, stated so that they stay the bound on how much of an upload ffmpeg reads
// to identify its streams, whatever a later ffmpeg build defaults to.
const PROBE_SIZE_BYTES = 5_000_000;
const ANALYZE_DURATION_MICROSECONDS = 5_000_000;

const STREAM_LINE = /^\s*Stream #0:\d+\S*: (Video|Audio|Subtitle|Data|Attachment): (.*)$/;
const DIMENSIONS = /, (\d{1,5})x(\d{1,5})[ ,]/;
const ROTATION = /displaymatrix: rotation of (-?[\d.]+) degrees/;
const DURATION = /^\s*Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/m;
const LAST_TIMESTAMP = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g;
// What ffmpeg says when the input opened but had nothing to copy, e.g. only subtitles.
const NOTHING_TO_COPY = /does not contain any stream/;

function toSeconds(hours: string, minutes: string, seconds: string): number {
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function readDuration(log: string, packetEndSeconds: number): number {
  const header = log.match(DURATION);
  const headerSeconds = header ? toSeconds(header[1], header[2], header[3]) : 0;
  // A header can be missing (a browser recording) or understate the length; the time of
  // the last packet read is how much ffmpeg would actually encode. FFmpeg 6 reports it in
  // its final progress line; FFmpeg 7 prints time=N/A there when the packets carry no
  // presentation time, so the end of the last packet copied is measured as well.
  const lastPacket = [...log.matchAll(LAST_TIMESTAMP)].pop();
  const reportedSeconds = lastPacket ? toSeconds(lastPacket[1], lastPacket[2], lastPacket[3]) : 0;
  return Math.max(headerSeconds, reportedSeconds, packetEndSeconds);
}

// framecrc writes `#tb 0: <num>/<den>`, then one line per packet,
// `stream, dts, pts, duration, size, checksum[, flags]`, with times in that time base.
const TIME_BASE = /^#tb \d+: (\d+)\/(\d+)$/;

class PacketList {
  count = 0;
  private endTicks = Number.NEGATIVE_INFINITY;
  private secondsPerTick = 0;

  readLine(line: string): void {
    if (line === '') return;
    if (line.startsWith('#')) {
      const timeBase = line.match(TIME_BASE);
      if (timeBase) this.secondsPerTick = Number(timeBase[1]) / Number(timeBase[2]);
      return;
    }
    this.count += 1;
    const [, dts, , duration] = line.split(',').map(Number);
    if (Number.isFinite(dts) && Number.isFinite(duration)) {
      this.endTicks = Math.max(this.endTicks, dts + duration);
    }
  }

  get endSeconds(): number {
    return Number.isFinite(this.endTicks) ? Math.max(0, this.endTicks * this.secondsPerTick) : 0;
  }
}

function readStreams(log: string): Pick<VideoProbe, 'video' | 'audioStreamCount'> {
  let video: VideoProbe['video'] = null;
  let readingFirstVideo = false;
  let audioStreamCount = 0;

  for (const line of log.split(/\r?\n/)) {
    // The output's stream list repeats the streams the probe copied.
    if (line.startsWith('Output #')) {
      break;
    }
    const stream = line.match(STREAM_LINE);
    if (stream) {
      const [, kind, details] = stream;
      const dimensions = details.match(DIMENSIONS);
      readingFirstVideo = false;
      if (kind === 'Audio') {
        audioStreamCount += 1;
      } else if (kind === 'Video' && !video && !details.includes('(attached pic)') && dimensions) {
        video = { width: Number(dimensions[1]), height: Number(dimensions[2]), rotation: 0, frameCount: 0 };
        readingFirstVideo = true;
      }
      continue;
    }
    // A stream's side data is indented under it; the next unindented line ends the input.
    if (/^\S/.test(line)) {
      readingFirstVideo = false;
    }
    const rotation = line.match(ROTATION);
    if (readingFirstVideo && video && rotation) {
      video.rotation = Number(rotation[1]);
    }
  }
  return { video, audioStreamCount };
}

/**
 * Describes the upload at `inputPath` without decoding it: the input's streams from its
 * header, then every packet of the first video stream copied to a checksum list, which
 * counts its frames and finds its true length. This reads the file once, at about the
 * cost of copying it.
 *
 * Rejects with the error `runFfmpeg` gives when the input cannot be opened or the probe
 * outlasts `deadlineMs`.
 */
export async function probeVideo(
  inputPath: string,
  { deadlineMs, signal }: { deadlineMs: number; signal?: AbortSignal },
): Promise<VideoProbe> {
  const packets = new PacketList();
  let partialLine = '';
  const readPackets = (text: string) => {
    for (const line of text.split('\n')) packets.readLine(line.trimEnd());
  };

  let log: string;
  try {
    log = await runFfmpeg({
      args: [
        '-nostats',
        '-probesize', String(PROBE_SIZE_BYTES),
        '-analyzeduration', String(ANALYZE_DURATION_MICROSECONDS),
        '-i', inputPath,
        '-map', '0:V:0?',
        '-c', 'copy',
        '-f', 'framecrc',
        'pipe:1',
      ],
      deadlineMs,
      signal,
      onStdout: (chunk) => {
        const text = partialLine + chunk;
        const lastNewline = text.lastIndexOf('\n');
        readPackets(text.slice(0, lastNewline + 1));
        partialLine = text.slice(lastNewline + 1);
      },
    });
  } catch (error) {
    if (!(error instanceof FfmpegExitError && NOTHING_TO_COPY.test(error.stderr))) {
      throw error;
    }
    log = error.stderr;
  }
  readPackets(partialLine);

  const { video, audioStreamCount } = readStreams(log);
  if (video) {
    video.frameCount = packets.count;
  }

  return {
    container: log.match(/^Input #0, (.+?), from /m)?.[1] ?? '',
    majorBrand: log.match(/^\s*major_brand\s*: (\S+)/m)?.[1] ?? null,
    durationSeconds: readDuration(log, packets.endSeconds),
    video,
    audioStreamCount,
  };
}
