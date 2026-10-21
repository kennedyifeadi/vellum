// Sends one ordinary guest request to each tool family of a running server and checks the
// output's format. With --heavy it then sends two image jobs at the pixel cap at once, to
// measure the server's memory under its heaviest in-memory work. Run from the repository
// root (it uses the app's own dependencies to generate inputs):
//   node scripts/container-smoke.mjs http://localhost:3000 [--heavy]
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const heavy = process.argv.includes('--heavy');

const SIGNATURES = {
  pdf: Buffer.from('%PDF-'),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  zip: Buffer.from('PK'),
};

async function jpeg() {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: '#3a7bd5' } }).jpeg().toBuffer();
}

// 7000 x 7000 is 49 MP, just under MAX_IMAGE_PIXELS; one flat colour keeps the file small.
async function pngAtPixelCap() {
  return sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#88aa44' } }).png().toBuffer();
}

async function textPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Vellum container smoke test', { x: 50, y: 700, size: 18, font });
  return Buffer.from(await pdf.save());
}

async function docx() {
  return Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Vellum container smoke test')] }] }));
}

// A 24-bit bottom-up BMP, which Image to PDF decodes with ffmpeg.
function bmp(width = 64, height = 48) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.set([x * 4, y * 5, 200], y * stride + x * 3);
    }
  }
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixels.length, 34);
  return Buffer.concat([header, pixels]);
}

function mp4() {
  const out = path.join(os.tmpdir(), `smoke-${process.pid}.mp4`);
  try {
    execFileSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=25',
      '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', out,
    ]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

function form(field, files) {
  const body = new FormData();
  for (const [name, bytes, type] of files) {
    body.append(field, new Blob([bytes], { type }), name);
  }
  return body;
}

const checks = [
  ['health', async () => fetch(`${baseUrl}/api/health`), (bytes) => JSON.parse(bytes).status === 'ok'],
  ['jpg-to-png (sharp)', async () => fetch(`${baseUrl}/api/convert/jpg-to-png`, {
    method: 'POST', body: form('images', [['photo.jpg', await jpeg(), 'image/jpeg']]),
  }), 'png'],
  ['pdf-to-docx (worker thread)', async () => fetch(`${baseUrl}/api/convert/pdf-to-docx`, {
    method: 'POST', body: form('pdf', [['text.pdf', await textPdf(), 'application/pdf']]),
  }), 'zip'],
  ['html-to-pdf (Chromium)', async () => fetch(`${baseUrl}/api/convert/html-to-pdf`, {
    method: 'POST', body: form('html', [['page.html', Buffer.from('<h1>Vellum smoke test</h1>'), 'text/html']]),
  }), 'pdf'],
  ['docx-to-pdf (Chromium)', async () => fetch(`${baseUrl}/api/convert/docx-to-pdf`, {
    method: 'POST',
    body: form('docx', [['doc.docx', await docx(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]),
  }), 'pdf'],
  ['image-to-pdf with BMP (ffmpeg)', async () => fetch(`${baseUrl}/api/convert/image-to-pdf`, {
    method: 'POST', body: form('images', [['image.bmp', bmp(), 'image/bmp']]),
  }), 'pdf'],
  ['video-compress (ffmpeg)', async () => fetch(`${baseUrl}/api/convert/video-compress`, {
    method: 'POST', body: form('video', [['clip.mp4', mp4(), 'video/mp4']]),
  }), (bytes) => bytes.subarray(4, 8).toString('latin1') === 'ftyp'],
];

async function runCheck([name, send, expected]) {
  const started = Date.now();
  try {
    const res = await send();
    const bytes = Buffer.from(await res.arrayBuffer());
    const ok = res.status === 200 && (typeof expected === 'function'
      ? expected(bytes)
      : bytes.subarray(0, SIGNATURES[expected].length).equals(SIGNATURES[expected]));
    const detail = ok ? `${bytes.length} bytes` : bytes.subarray(0, 300).toString('utf8');
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: HTTP ${res.status}, ${Date.now() - started} ms, ${detail}`);
    return ok;
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    return false;
  }
}

async function heavyChecks() {
  const png = await pngAtPixelCap();
  const pair = (name, path, check) => [1, 2].map((n) => [`${name} at the pixel cap (${n} of 2, concurrent)`, async () =>
    fetch(`${baseUrl}${path}`, { method: 'POST', body: form('images', [['large.png', png, 'image/png']]) }), check]);
  return [
    pair('image-to-pdf', '/api/convert/image-to-pdf', 'pdf'),
    pair('image-compress', '/api/convert/image-compress', (bytes) => bytes.length > 0),
  ];
}

let failed = 0;
for (const check of checks) {
  if (!(await runCheck(check))) failed++;
}
const heavyGroups = heavy ? await heavyChecks() : [];
for (const group of heavyGroups) {
  const results = await Promise.all(group.map(runCheck));
  failed += results.filter((ok) => !ok).length;
}

const total = checks.length + heavyGroups.flat().length;
if (failed) {
  console.log(`${failed} of ${total} smoke checks failed`);
  process.exit(1);
}
console.log(`All ${total} smoke checks passed`);
