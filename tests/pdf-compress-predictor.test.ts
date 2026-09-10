import zlib from 'zlib';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { compressPdf } from '../lib/pdf/compress';

const WIDTH = 256;
const HEIGHT = 180;
const CHANNELS = 3;
const ROW_SIZE = WIDTH * CHANNELS;

// Gradient (R ramps across, G ramps down, B constant) plus deterministic
// high-frequency noise so the Flate stream does not out-compress the JPEG the
// recompression path produces — otherwise no swap happens and the test would
// pass without exercising the predictor decode at all.
function buildImage(): Buffer {
  const raw = Buffer.alloc(WIDTH * HEIGHT * CHANNELS);
  let seed = 0x2545f491;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed >> 8) % 41) - 20;
  };
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * CHANNELS;
      const clamp = (v: number) => Math.max(0, Math.min(255, v));
      raw[i] = clamp(Math.round((x / (WIDTH - 1)) * 255) + noise());
      raw[i + 1] = clamp(Math.round((y / (HEIGHT - 1)) * 255) + noise());
      raw[i + 2] = clamp(200 + noise());
    }
  }
  return raw;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function pngEncode(raw: Buffer, filterForRow: (row: number) => number): Buffer {
  const out = Buffer.alloc(HEIGHT * (ROW_SIZE + 1));
  for (let y = 0; y < HEIGHT; y++) {
    const filter = filterForRow(y);
    const o = y * (ROW_SIZE + 1);
    out[o] = filter;
    for (let j = 0; j < ROW_SIZE; j++) {
      const cur = raw[y * ROW_SIZE + j];
      const left = j >= CHANNELS ? raw[y * ROW_SIZE + j - CHANNELS] : 0;
      const up = y > 0 ? raw[(y - 1) * ROW_SIZE + j] : 0;
      const upLeft = y > 0 && j >= CHANNELS ? raw[(y - 1) * ROW_SIZE + j - CHANNELS] : 0;
      let v = 0;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur - left; break;
        case 2: v = cur - up; break;
        case 3: v = cur - Math.floor((left + up) / 2); break;
        case 4: v = cur - paeth(left, up, upLeft); break;
      }
      out[o + 1 + j] = v & 0xff;
    }
  }
  return out;
}

function tiffEncode(raw: Buffer): Buffer {
  const out = Buffer.alloc(HEIGHT * ROW_SIZE);
  for (let y = 0; y < HEIGHT; y++) {
    for (let j = 0; j < ROW_SIZE; j++) {
      const cur = raw[y * ROW_SIZE + j];
      const left = j >= CHANNELS ? raw[y * ROW_SIZE + j - CHANNELS] : 0;
      out[y * ROW_SIZE + j] = (cur - left) & 0xff;
    }
  }
  return out;
}

async function buildPdfWithImage(predictor: number, encoded: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const deflated = zlib.deflateSync(encoded);

  const dict = ctx.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: WIDTH,
    Height: HEIGHT,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'FlateDecode',
    DecodeParms: ctx.obj({
      Predictor: predictor,
      Colors: CHANNELS,
      BitsPerComponent: 8,
      Columns: WIDTH,
    }),
  });
  const imageRef = ctx.register(PDFRawStream.of(dict, deflated));

  const page = doc.addPage([WIDTH, HEIGHT]);
  page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Im0: imageRef } }));
  const content = `q ${WIDTH} 0 0 ${HEIGHT} 0 0 cm /Im0 Do Q`;
  page.node.set(PDFName.of('Contents'), ctx.register(PDFRawStream.of(ctx.obj({}), Buffer.from(content, 'latin1'))));

  return Buffer.from(await doc.save());
}

interface ChannelStat {
  mean: number;
  stdev: number;
}

function toStats(channels: sharp.Stats['channels']): ChannelStat[] {
  return channels.map((c) => ({ mean: c.mean, stdev: c.stdev }));
}

function findImageStream(doc: PDFDocument): PDFRawStream {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = obj.dict.get(PDFName.of('Subtype'));
    if (subtype && subtype.toString() === '/Image') return obj;
  }
  throw new Error('no image XObject found in PDF');
}

async function readImage(pdfBuffer: Buffer): Promise<{ filter: string; stats: ChannelStat[] }> {
  const doc = await PDFDocument.load(pdfBuffer);
  const obj = findImageStream(doc);
  const filter = obj.dict.get(PDFName.of('Filter'))?.toString() ?? '';
  const contents = Buffer.from(obj.contents);

  let pixels: sharp.Sharp;
  if (filter === '/DCTDecode') {
    pixels = sharp(contents);
  } else {
    const inflated = zlib.inflateSync(contents);
    const w = (obj.dict.get(PDFName.of('Width')) as any).numberValue;
    const h = (obj.dict.get(PDFName.of('Height')) as any).numberValue;
    pixels = sharp(inflated, { raw: { width: w, height: h, channels: 3 } });
  }
  const rgb = await pixels.removeAlpha().toColorspace('srgb').raw().toBuffer();
  const stats = await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).stats();
  return { filter, stats: toStats(stats.channels) };
}

async function imageStreamBytes(pdfBuffer: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBuffer);
  return Buffer.from(findImageStream(doc).contents);
}

function expectClose(actual: ChannelStat[], reference: ChannelStat[], meanTol: number, stdevTol: number) {
  for (let c = 0; c < CHANNELS; c++) {
    expect(Math.abs(actual[c].mean - reference[c].mean)).toBeLessThanOrEqual(meanTol);
    expect(Math.abs(actual[c].stdev - reference[c].stdev)).toBeLessThanOrEqual(stdevTol);
  }
}

describe('compressPdf predictor handling (issue #45)', () => {
  const image = buildImage();
  let sourceStats: ChannelStat[];

  beforeAll(async () => {
    const s = await sharp(image, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).stats();
    sourceStats = toStats(s.channels);
  });

  const pngCases: Array<[number, (row: number) => number]> = [
    [10, () => 0],
    [11, () => 1],
    [12, () => 2],
    [13, () => 3],
    [14, () => 4],
    [15, (row) => row % 5],
  ];

  it.each(pngCases)('recompresses a PNG predictor %i image without corrupting it', async (predictor, filterForRow) => {
    const pdfBuffer = await buildPdfWithImage(predictor, pngEncode(image, filterForRow));

    const result = await compressPdf({ pdfBuffer, level: 'medium' });
    const { filter, stats } = await readImage(result.buffer);

    expect(filter).toBe('/DCTDecode');
    expectClose(stats, sourceStats, 10, 18);
  });

  it('recompresses a TIFF predictor 2 image without corrupting it', async () => {
    const pdfBuffer = await buildPdfWithImage(2, tiffEncode(image));

    const result = await compressPdf({ pdfBuffer, level: 'medium' });
    const { filter, stats } = await readImage(result.buffer);

    expect(filter).toBe('/DCTDecode');
    expectClose(stats, sourceStats, 10, 18);
  });

  it('leaves the image stream untouched when the predictor is not one it can decode', async () => {
    const pdfBuffer = await buildPdfWithImage(7, pngEncode(image, () => 0));
    const before = await imageStreamBytes(pdfBuffer);

    const result = await compressPdf({ pdfBuffer, level: 'medium' });

    const doc = await PDFDocument.load(result.buffer);
    const obj = findImageStream(doc);
    expect(obj.dict.get(PDFName.of('Filter'))?.toString()).toBe('/FlateDecode');
    expect(Buffer.from(obj.contents).equals(before)).toBe(true);
  });
});
