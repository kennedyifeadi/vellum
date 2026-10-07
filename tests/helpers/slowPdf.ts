import { deflateSync } from 'zlib';

const SHOW_TEXT = '(x)Tj\n';

function contentStream(decodedMb: number): Buffer {
  const operatorCount = Math.floor((decodedMb * 1024 * 1024) / SHOW_TEXT.length);
  return deflateSync(Buffer.from(`BT /F1 8 Tf 20 820 Td 9 TL\n${SHOW_TEXT.repeat(operatorCount)}ET\n`));
}

/**
 * A PDF of a few kilobytes that pdf.js needs seconds to extract: every page shares one
 * Flate-compressed content stream of `decodedMb` megabytes of text operators (#90).
 */
export function createSlowPdf(decodedMb: number, pageCount = 1): Buffer {
  const stream = contentStream(decodedMb);
  const pageRefs = Array.from({ length: pageCount }, (_, pageIndex) => `${5 + pageIndex} 0 R`);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from(`<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageCount} >>`),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),
      stream,
      Buffer.from('\nendstream'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    ...pageRefs.map(() =>
      Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 3 0 R >>',
      ),
    ),
  ];

  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let position = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(position);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    position += chunk.length;
  });

  const xrefEntries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefEntries}` +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

/** Starts watching the event loop; the returned function reports the longest gap between timer ticks. */
export function trackEventLoopStall(): () => number {
  let lastTick = performance.now();
  let longestGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - lastTick);
    lastTick = now;
  }, 20);

  return () => {
    clearInterval(timer);
    return Math.max(longestGap, performance.now() - lastTick);
  };
}
