import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { ClientError } from '@/lib/convert/errors';
import {
  assertDurationWithinLimit,
  FFMPEG_THREADS,
  PROBE_DEADLINE_MS,
  VIDEO_TOO_SLOW_MESSAGE,
  X264_PRESET,
} from '@/lib/convert/video-compress-limits';
import { assertInsideDir } from '@/lib/paths';
import { FfmpegExitError, FfmpegStoppedError, runFfmpeg } from '@/lib/video/ffmpeg';
import { probeVideo, type VideoProbe } from '@/lib/video/probe';

interface CompressVideoOptions {
  inputBuffer: Buffer;
  fileName: string;
  crf: number;
  resolution?: string;
  maxDurationSeconds: number;
  encodeDeadlineMs: number;
  signal?: AbortSignal;
}

export interface VideoFormat {
  extension: string;
  contentType: string;
}

export interface CompressedVideo {
  bytes: Buffer;
  /** False when the re-encode was not smaller and `bytes` is the upload, unchanged. */
  compressed: boolean;
  format: VideoFormat;
}

const UNREADABLE_MESSAGE = 'That file could not be read as a video.';
const NO_MOTION_MESSAGE = 'That file has no moving video to compress. Please upload a video with more than one frame.';
const CANCELLED_MESSAGE = 'The upload was cancelled.';

const MP4: VideoFormat = { extension: 'mp4', contentType: 'video/mp4' };

const SHORT_EDGE_CEILINGS: Record<string, number> = {
  '720p': 720,
  '480p': 480,
};

// ffmpeg names the reason it could not open the input at the end of this line. Only
// these reasons are the upload's fault; "No such file or directory", "Permission denied"
// and the like mean the server could not hand it the file. "Operation not permitted" is
// the concat demuxer refusing a playlist that names another file ("Unsafe file name").
const INPUT_OPEN_FAILURE = /Error opening input: (.+)$/m;
const UNREADABLE_INPUT_REASONS = [
  'Invalid data found when processing input',
  'End of file',
  'Invalid argument',
  'Not yet implemented in FFmpeg',
];

function isUnreadableInput(stderr: string): boolean {
  const reason = stderr.match(INPUT_OPEN_FAILURE)?.[1] ?? '';
  if (reason.includes('Operation not permitted')) {
    return stderr.includes('Unsafe file name');
  }
  return UNREADABLE_INPUT_REASONS.some((known) => reason.includes(known));
}

// Reached only after the probe opened the file, so a stream ffmpeg has no decoder for is
// the one encode failure the upload causes; every other one is the server's.
function isUndecodableInput(stderr: string): boolean {
  return /no decoder found/i.test(stderr);
}

const KNOWN_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.3gp', '.wmv', '.flv',
]);

// The extension is only a hint for ffmpeg's container probing; anything unrecognised
// gets a neutral one so no client-supplied text ever lands in a path. It also keeps
// ffmpeg's HLS demuxer from ever being chosen for an uploaded playlist.
function inputExtension(fileName: string): string {
  const ext = path.extname(path.basename(fileName ?? '')).toLowerCase();
  return KNOWN_VIDEO_EXTENSIONS.has(ext) ? ext : '.tmp';
}

function tempPath(name: string): string {
  return assertInsideDir(tmpdir(), path.join(tmpdir(), name));
}

const FORMATS_BY_DEMUXER: Record<string, VideoFormat> = {
  avi: { extension: 'avi', contentType: 'video/x-msvideo' },
  asf: { extension: 'wmv', contentType: 'video/x-ms-wmv' },
  flv: { extension: 'flv', contentType: 'video/x-flv' },
  gif: { extension: 'gif', contentType: 'image/gif' },
  mpegts: { extension: 'ts', contentType: 'video/mp2t' },
  mpeg: { extension: 'mpg', contentType: 'video/mpeg' },
  ogg: { extension: 'ogv', contentType: 'video/ogg' },
};

/** The container the probe found, for returning the upload as it is. */
function originalFormat(probe: VideoProbe, fileName: string): VideoFormat {
  if (probe.container.startsWith('mov,mp4')) {
    if (probe.majorBrand === 'qt') return { extension: 'mov', contentType: 'video/quicktime' };
    if (probe.majorBrand?.startsWith('3g')) return { extension: '3gp', contentType: 'video/3gpp' };
    return MP4;
  }
  if (probe.container === 'matroska,webm') {
    // One demuxer reads both; the upload's name only picks between the two labels.
    return inputExtension(fileName) === '.webm'
      ? { extension: 'webm', contentType: 'video/webm' }
      : { extension: 'mkv', contentType: 'video/x-matroska' };
  }
  return FORMATS_BY_DEMUXER[probe.container] ?? { extension: 'bin', contentType: 'application/octet-stream' };
}

/**
 * The output size for `resolution`: its number caps the short edge, for portrait and
 * landscape alike, and a smaller video is never enlarged. Both sides are kept even, as
 * yuv420p needs, and the aspect ratio is kept to within a pixel.
 */
export function outputDimensions(width: number, height: number, resolution?: string): { width: number; height: number } {
  const ceiling = SHORT_EDGE_CEILINGS[resolution ?? ''];
  const shortEdge = Math.min(width, height);
  if (!ceiling || shortEdge <= ceiling) {
    return { width: Math.max(2, width - (width % 2)), height: Math.max(2, height - (height % 2)) };
  }
  const scale = ceiling / shortEdge;
  return {
    width: Math.max(2, 2 * Math.round((width * scale) / 2)),
    height: Math.max(2, 2 * Math.round((height * scale) / 2)),
  };
}

function uprightDimensions(video: NonNullable<VideoProbe['video']>): { width: number; height: number } {
  const quarterTurns = Math.round(video.rotation / 90);
  return quarterTurns % 2 === 0
    ? { width: video.width, height: video.height }
    : { width: video.height, height: video.width };
}

function encodeArguments(inputPath: string, outputPath: string, video: NonNullable<VideoProbe['video']>, crf: number, resolution?: string): string[] {
  // ffmpeg turns rotated video upright before the filters run, so the target is sized
  // from the upright picture and no rotation flag is written to the output.
  const upright = uprightDimensions(video);
  const target = outputDimensions(upright.width, upright.height, resolution);
  const threads = String(FFMPEG_THREADS);

  return [
    '-threads', threads,
    '-i', inputPath,
    '-map', '0:V:0',
    '-map', '0:a?',
    '-sn',
    '-dn',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-filter_threads', '1',
    '-vf', `scale=${target.width}:${target.height},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', X264_PRESET,
    '-profile:v', 'high',
    '-crf', String(crf),
    '-threads', threads,
    '-c:a', 'aac',
    '-movflags', '+faststart',
    '-f', 'mp4',
    '-y', outputPath,
  ];
}

function toClientFacingError(error: unknown, stage: 'probe' | 'encode'): unknown {
  if (error instanceof FfmpegStoppedError) {
    return new ClientError(error.reason === 'deadline' ? VIDEO_TOO_SLOW_MESSAGE : CANCELLED_MESSAGE, 400, { cause: error });
  }
  if (error instanceof FfmpegExitError) {
    const clientFault = stage === 'probe' ? isUnreadableInput(error.stderr) : isUndecodableInput(error.stderr);
    if (clientFault) {
      return new ClientError(UNREADABLE_MESSAGE, 400, { cause: error });
    }
  }
  return error;
}

async function probeUpload(inputPath: string, signal?: AbortSignal): Promise<VideoProbe> {
  try {
    return await probeVideo(inputPath, { deadlineMs: PROBE_DEADLINE_MS, signal });
  } catch (error) {
    throw toClientFacingError(error, 'probe');
  }
}

function movingVideo(probe: VideoProbe): NonNullable<VideoProbe['video']> {
  if (!probe.container) {
    throw new ClientError(UNREADABLE_MESSAGE);
  }
  if (!probe.video || probe.video.frameCount < 2) {
    throw new ClientError(NO_MOTION_MESSAGE);
  }
  return probe.video;
}

async function removeTempFiles(...paths: string[]): Promise<void> {
  try {
    await Promise.all(paths.map((tempFile) => fs.rm(tempFile, { force: true })));
  } catch (cleanupError) {
    console.error('Failed to cleanup temp files:', cleanupError);
  }
}

/**
 * Re-encodes an uploaded video as H.264/AAC MP4 for broad playback, or returns the
 * upload unchanged when the re-encode is not smaller. Inputs without moving video, and
 * videos longer than `maxDurationSeconds`, are refused after a probe and before anything
 * is encoded. ffmpeg is killed when its deadline passes or `signal` aborts, and the temp
 * files are gone before this settles.
 */
export async function compressVideo({
  inputBuffer,
  fileName,
  crf,
  resolution,
  maxDurationSeconds,
  encodeDeadlineMs,
  signal,
}: CompressVideoOptions): Promise<CompressedVideo> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new ClientError('The video file is empty.');
  }

  const id = randomUUID();
  const inputPath = tempPath(`input-${id}${inputExtension(fileName)}`);
  const outputPath = tempPath(`output-${id}.mp4`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    const probe = await probeUpload(inputPath, signal);
    const video = movingVideo(probe);
    assertDurationWithinLimit(probe.durationSeconds, maxDurationSeconds);

    try {
      await runFfmpeg({
        args: encodeArguments(inputPath, outputPath, video, crf, resolution),
        deadlineMs: encodeDeadlineMs,
        signal,
      });
    } catch (error) {
      throw toClientFacingError(error, 'encode');
    }

    const { size } = await fs.stat(outputPath);
    if (size >= inputBuffer.length) {
      return { bytes: inputBuffer, compressed: false, format: originalFormat(probe, fileName) };
    }
    return { bytes: await fs.readFile(outputPath), compressed: true, format: MP4 };
  } finally {
    await removeTempFiles(inputPath, outputPath);
  }
}
