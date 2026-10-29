// Sends one ordinary guest request to each tool family of a running server and checks the
// output's format. With --heavy it then sends an Image to PDF and a Compress Image job at
// the pixel cap, one after the other, to measure the server's memory under its heaviest
// in-memory work. They cannot run at once: every request here is a guest, and guests may
// run one job at a time between them and hold one slot of each pool (#106). With
// --heavy-render html or --heavy-render docx it sends only that one render, of an input
// near the guest size cap, so the workflow can measure the memory one render takes. Run
// from the repository root (it uses the app's own dependencies to generate inputs):
//   node scripts/container-smoke.mjs http://localhost:3000 [--heavy | --heavy-render html|docx]
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, ImageRun, Packer, Paragraph } from 'docx';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const heavy = process.argv.includes('--heavy');
const heavyRender = process.argv.includes('--heavy-render') ? process.argv[process.argv.indexOf('--heavy-render') + 1] : null;

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

// Random noise, so neither PNG compression nor a shared image cache makes it cheap.
async function noisePng(size) {
  return sharp({ create: { width: size, height: size, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
    .png()
    .toBuffer();
}

// About 23 MB, under the guest cap of 25 MB: a 5000-row table and three full-width images.
async function heavyHtml() {
  let rows = '';
  for (let i = 0; i < 5000; i++) {
    rows += `<tr><td>${i}</td><td>Row ${i} of the heavy smoke page</td><td style="background:#${(i * 40503).toString(16).slice(-6).padStart(6, '0')}">${(i * 7919) % 10007}</td></tr>`;
  }
  let html = `<!doctype html><html><body><h1>Heavy smoke page</h1><table border="1">${rows}</table>`;
  for (let i = 0; i < 3; i++) {
    html += `<img style="width:100%" src="data:image/png;base64,${(await noisePng(1400)).toString('base64')}">`;
  }
  return Buffer.from(`${html}</body></html>`);
}

// About 22 MB, under the guest cap: 3000 paragraphs and seven distinct images, which
// mammoth inlines into the HTML it hands Chromium.
async function largeDocx() {
  const children = [];
  for (let i = 0; i < 3000; i++) {
    children.push(new Paragraph(`Paragraph ${i} of the large smoke document, lorem ipsum dolor sit amet.`));
  }
  for (let i = 0; i < 7; i++) {
    children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: await noisePng(1000), transformation: { width: 600, height: 600 } })] }));
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
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
  const atPixelCap = (name, path, check) => [`${name} at the pixel cap`, async () =>
    fetch(`${baseUrl}${path}`, { method: 'POST', body: form('images', [['large.png', png, 'image/png']]) }), check];
  return [
    atPixelCap('image-to-pdf', '/api/convert/image-to-pdf', 'pdf'),
    atPixelCap('image-compress', '/api/convert/image-compress', (bytes) => bytes.length > 0),
  ];
}

async function heavyRenderChecks(tool) {
  if (tool === 'html') {
    const html = await heavyHtml();
    return [[`html-to-pdf of a ${(html.length / 1024 / 1024).toFixed(1)} MB page`, async () => fetch(`${baseUrl}/api/convert/html-to-pdf`, {
      method: 'POST', body: form('html', [['heavy.html', html, 'text/html']]),
    }), 'pdf']];
  }
  if (tool === 'docx') {
    const docx = await largeDocx();
    return [[`docx-to-pdf of a ${(docx.length / 1024 / 1024).toFixed(1)} MB document`, async () => fetch(`${baseUrl}/api/convert/docx-to-pdf`, {
      method: 'POST',
      body: form('docx', [['large.docx', docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]),
    }), 'pdf']];
  }
  throw new Error(`--heavy-render takes html or docx, not ${tool}`);
}

const selected = heavyRender ? await heavyRenderChecks(heavyRender) : [...checks, ...(heavy ? await heavyChecks() : [])];
let failed = 0;
for (const check of selected) {
  if (!(await runCheck(check))) failed++;
}

const total = selected.length;
if (failed) {
  console.log(`${failed} of ${total} smoke checks failed`);
  process.exit(1);
}
console.log(`All ${total} smoke checks passed`);
