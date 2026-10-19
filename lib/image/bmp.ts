import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export interface BmpHeader {
  width: number;
  height: number;
  /** Whether the file defines an alpha channel; most BMPs leave the fourth byte unused. */
  hasAlpha: boolean;
  /** Pixels per inch, when the file states it. */
  density?: number;
}

const FILE_HEADER_SIZE = 14;
const BI_RGB = 0;
const BI_RLE8 = 1;
const BI_RLE4 = 2;
const BI_BITFIELDS = 3;
const INCHES_PER_METRE = 0.0254;

// Windows (40 to 124 bytes) and OS/2 1.x (12 bytes) headers. OS/2 2.x (64 bytes) reuses
// the compression numbers for other methods, so it is not accepted.
const CORE_HEADER_SIZE = 12;
const INFO_HEADER_SIZES = new Set([40, 52, 56, 108, 124]);
const V3_HEADER_SIZE = 56;
const ALPHA_MASK_OFFSET = FILE_HEADER_SIZE + 52;

const DEPTHS_BY_COMPRESSION: Record<number, number[]> = {
  [BI_RGB]: [1, 4, 8, 16, 24, 32],
  [BI_RLE8]: [8],
  [BI_RLE4]: [4],
  [BI_BITFIELDS]: [16, 32],
};

function readCoreHeader(bytes: Buffer): BmpHeader | null {
  const planes = bytes.readUInt16LE(22);
  const bitsPerPixel = bytes.readUInt16LE(24);
  const width = bytes.readUInt16LE(18);
  const height = bytes.readUInt16LE(20);
  if (planes !== 1 || ![1, 4, 8, 24].includes(bitsPerPixel) || width === 0 || height === 0) {
    return null;
  }
  return { width, height, hasAlpha: false };
}

function readInfoHeader(bytes: Buffer, headerSize: number): BmpHeader | null {
  const width = bytes.readInt32LE(18);
  const signedHeight = bytes.readInt32LE(22);
  const planes = bytes.readUInt16LE(26);
  const bitsPerPixel = bytes.readUInt16LE(28);
  const compression = bytes.readUInt32LE(30);
  const pixelsPerMetre = bytes.readInt32LE(38);

  const topDown = signedHeight < 0;
  const isRunLength = compression === BI_RLE8 || compression === BI_RLE4;
  if (
    planes !== 1 ||
    width <= 0 ||
    signedHeight === 0 ||
    signedHeight === -0x80000000 ||
    !DEPTHS_BY_COMPRESSION[compression]?.includes(bitsPerPixel) ||
    (topDown && isRunLength)
  ) {
    return null;
  }

  const hasAlpha =
    bitsPerPixel === 32 &&
    compression === BI_BITFIELDS &&
    headerSize >= V3_HEADER_SIZE &&
    bytes.readUInt32LE(ALPHA_MASK_OFFSET) !== 0;
  return {
    width,
    height: Math.abs(signedHeight),
    hasAlpha,
    density: pixelsPerMetre > 0 ? pixelsPerMetre * INCHES_PER_METRE : undefined,
  };
}

/**
 * Reads a BMP's header, or returns null when the bytes are not a BMP of a kind that
 * can be decoded: a `BM` file header pointing at pixel data inside the file, and an
 * information header with a known size, one plane, positive dimensions and a bit depth
 * its compression method is defined for.
 */
export function readBmpHeader(bytes: Buffer): BmpHeader | null {
  if (bytes.length < FILE_HEADER_SIZE + 4 || bytes.toString('latin1', 0, 2) !== 'BM') {
    return null;
  }
  const pixelDataOffset = bytes.readUInt32LE(10);
  const headerSize = bytes.readUInt32LE(FILE_HEADER_SIZE);
  const isCore = headerSize === CORE_HEADER_SIZE;
  if (
    (!isCore && !INFO_HEADER_SIZES.has(headerSize)) ||
    bytes.length < FILE_HEADER_SIZE + headerSize ||
    pixelDataOffset < FILE_HEADER_SIZE + headerSize ||
    pixelDataOffset >= bytes.length
  ) {
    return null;
  }
  return isCore ? readCoreHeader(bytes) : readInfoHeader(bytes, headerSize);
}

export class BmpDecodeTimeoutError extends Error {
  constructor() {
    super('Decoding a BMP took longer than the conversion allows');
    this.name = 'BmpDecodeTimeoutError';
  }
}

/**
 * Decodes a BMP whose header `readBmpHeader` has accepted into raw 8-bit RGB (or RGBA
 * when it has alpha), top row first. sharp cannot read BMP, and the pure-JavaScript
 * decoders on npm mishandle common variants, so this uses the ffmpeg binary the app
 * already ships for video: a separate process, killed if it outlives `timeoutMs`, whose
 * output is accepted only if it is exactly the size the header promises.
 */
export function decodeBmp(bytes: Buffer, header: BmpHeader, timeoutMs: number): Promise<Buffer> {
  if (!ffmpegPath) {
    return Promise.reject(new Error('No ffmpeg binary is available to decode BMP images'));
  }
  const channels = header.hasAlpha ? 4 : 3;
  const expectedLength = header.width * header.height * channels;

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegPath!,
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-f', 'bmp_pipe', '-i', 'pipe:0',
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', header.hasAlpha ? 'rgba' : 'rgb24', 'pipe:1',
      ],
      { windowsHide: true },
    );
    const output: Buffer[] = [];
    let outputLength = 0;
    let errorOutput = '';
    let timedOut = false;

    const deadline = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill('SIGKILL');
    }, timeoutMs);

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      outputLength += chunk.length;
      if (outputLength > expectedLength) {
        ffmpeg.kill('SIGKILL');
        return;
      }
      output.push(chunk);
    });
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorOutput = (errorOutput + chunk.toString()).slice(-2000);
    });
    // ffmpeg stops reading as soon as it gives up on a file, which breaks the pipe.
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    ffmpeg.on('close', (exitCode) => {
      clearTimeout(deadline);
      if (timedOut) {
        reject(new BmpDecodeTimeoutError());
      } else if (exitCode === 0 && outputLength === expectedLength) {
        resolve(Buffer.concat(output, expectedLength));
      } else {
        reject(new Error(`ffmpeg could not decode the BMP (exit code ${exitCode}): ${errorOutput.trim()}`));
      }
    });

    ffmpeg.stdin.end(bytes);
  });
}
