import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { ClientError } from '@/lib/convert/errors';
import { assertInsideDir } from '@/lib/paths';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

interface CompressVideoOptions {
  inputBuffer: Buffer;
  fileName: string;
  crf: number;
  resolution?: string;
}

// ffmpeg reports a bad container / non-video / truncated upload through its generic
// error channel; these fragments are the ones that mean "the input is at fault", not
// "the server is broken".
const BAD_INPUT_SIGNATURES = [
  'Invalid data found when processing input',
  'does not contain any stream',
  'Invalid argument',
  'End of file',
  'could not find codec parameters',
  'Unknown format',
];

function isBadInputError(message: string): boolean {
  const haystack = message.toLowerCase();
  return BAD_INPUT_SIGNATURES.some((sig) => haystack.includes(sig.toLowerCase()));
}

const KNOWN_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.3gp', '.wmv', '.flv',
]);

// The extension is only a hint for ffmpeg's container probing; anything unrecognised
// gets a neutral one so no client-supplied text ever lands in a path.
function inputExtension(fileName: string): string {
  const ext = path.extname(path.basename(fileName ?? '')).toLowerCase();
  return KNOWN_VIDEO_EXTENSIONS.has(ext) ? ext : '.tmp';
}

function tempPath(name: string): string {
  return assertInsideDir(tmpdir(), path.join(tmpdir(), name));
}

export async function compressVideo({
  inputBuffer,
  fileName,
  crf,
  resolution,
}: CompressVideoOptions): Promise<Buffer> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new ClientError('The video file is empty.');
  }

  const id = randomUUID();
  const inputPath = tempPath(`input-${id}${inputExtension(fileName)}`);
  const outputPath = tempPath(`output-${id}.mp4`);

  fs.writeFileSync(inputPath, inputBuffer);

  try {
    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .outputOptions(['-crf', String(crf)]);

      if (resolution === '720p') {
        command = command.size('?x720');
      } else if (resolution === '480p') {
        command = command.size('?x480');
      }

      command
        .on('end', () => resolve())
        .on('error', (err: Error) => {
          if (isBadInputError(err.message)) {
            reject(new ClientError('That file could not be read as a video.', 400, { cause: err }));
            return;
          }
          reject(err);
        })
        .save(outputPath);
    });

    return fs.readFileSync(outputPath);
  } finally {
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch (cleanupError) {
      console.error('Failed to cleanup temp files:', cleanupError);
    }
  }
}
