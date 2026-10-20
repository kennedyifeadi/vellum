import childProcess, { execFileSync, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import ffmpegStatic from 'ffmpeg-static';

const FFMPEG = ffmpegStatic as string;

/**
 * Runs the bundled ffmpeg with `args` (inputs, options and anything else before the
 * output name) and returns the file it writes, named with `extension`.
 */
export function makeMedia(args: string[], extension = 'mp4'): Buffer {
  const out = path.join(tmpdir(), `vc-sample-${randomUUID()}.${extension}`);
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, out]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

/** Passes `bytes` through ffmpeg with `inputOptions` before it and `outputOptions` after. */
export function remux(bytes: Buffer, inputOptions: string[], outputOptions: string[], extension = 'mp4'): Buffer {
  const source = path.join(tmpdir(), `vc-source-${randomUUID()}.${extension}`);
  fs.writeFileSync(source, bytes);
  try {
    return makeMedia([...inputOptions, '-i', source, ...outputOptions], extension);
  } finally {
    fs.rmSync(source, { force: true });
  }
}

/** A test pattern of `seconds` at `size` and `rate`, H.264 at `crf`, no audio. */
export function makeVideo({
  size = '320x240',
  rate = 25,
  seconds = 2,
  crf = 18,
  pixFmt = 'yuv420p',
  extra = [],
  extension = 'mp4',
}: {
  size?: string;
  rate?: number;
  seconds?: number;
  crf?: number;
  pixFmt?: string;
  extra?: string[];
  extension?: string;
} = {}): Buffer {
  return makeMedia(
    [
      '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=${seconds}`,
      '-c:v', 'libx264', '-crf', String(crf), '-pix_fmt', pixFmt,
      ...extra,
    ],
    extension,
  );
}

export interface MediaInfo {
  log: string;
  video: { codec: string; profile: string; pixFmt: string; width: number; height: number; sar: string; dar: string } | null;
  audioStreams: number;
  subtitleStreams: number;
  rotation: number | null;
  durationSeconds: number | null;
}

/** What the bundled ffmpeg reports about `bytes`, read from a temp copy. */
export function inspect(bytes: Buffer, extension = 'mp4'): MediaInfo {
  const file = path.join(tmpdir(), `vc-inspect-${randomUUID()}.${extension}`);
  fs.writeFileSync(file, bytes);
  try {
    const log = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
    const video = log.match(
      /Stream #0:\d+\S*: Video: (\w+) \(([^)]+)\)[^,]*, (\w+)\([^)]*\), (\d+)x(\d+) \[SAR (\d+:\d+) DAR (\d+:\d+)\]/,
    );
    const duration = log.match(/Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
    return {
      log,
      video: video
        ? {
            codec: video[1],
            profile: video[2],
            pixFmt: video[3],
            width: Number(video[4]),
            height: Number(video[5]),
            sar: video[6],
            dar: video[7],
          }
        : null,
      audioStreams: (log.match(/Stream #0:\d+\S*: Audio:/g) ?? []).length,
      subtitleStreams: (log.match(/Stream #0:\d+\S*: Subtitle:/g) ?? []).length,
      rotation: Number(log.match(/rotation of (-?[\d.]+) degrees/)?.[1] ?? NaN) || null,
      durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
    };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** The top-level box types of an MP4, in file order. */
export function topLevelBoxes(bytes: Buffer): string[] {
  const boxes: string[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset);
    boxes.push(bytes.subarray(offset + 4, offset + 8).toString('latin1'));
    if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
    if (size < 8) break;
    offset += size;
  }
  return boxes;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Records every process spawned through `child_process.spawn` while installed, so a test
 * can wait for a particular ffmpeg run to start and check that none is left running.
 */
export function trackSpawnedProcesses() {
  const spawned: { args: string[]; child: ChildProcess }[] = [];
  const realSpawn = childProcess.spawn;
  const spy = jest.spyOn(childProcess, 'spawn').mockImplementation(((...callArgs: Parameters<typeof realSpawn>) => {
    const child = (realSpawn as (...a: unknown[]) => ChildProcess)(...callArgs);
    spawned.push({ args: (callArgs[1] as string[]) ?? [], child });
    return child;
  }) as typeof realSpawn);

  return {
    spawned,
    encodes: () => spawned.filter(({ args }) => args.includes('libx264')),
    async untilEncodeStarted(): Promise<ChildProcess> {
      while (!spawned.some(({ args }) => args.includes('libx264'))) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return spawned.find(({ args }) => args.includes('libx264'))!.child;
    },
    /** Temp files named in a tracked process's arguments that still exist. */
    leftoverTempFiles: () =>
      spawned
        .flatMap(({ args }) => args)
        .filter((arg) => /[\\/](input|output)-[0-9a-f-]{36}\.\w+$/.test(arg) && fs.existsSync(arg)),
    stillRunning: () =>
      spawned.filter(({ child }) => child.pid !== undefined && isRunning(child.pid)).map(({ child }) => child.pid),
    restore: () => spy.mockRestore(),
  };
}
