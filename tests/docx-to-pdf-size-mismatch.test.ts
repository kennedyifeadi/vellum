import { NextRequest } from 'next/server';
import JSZip from 'jszip';

let mockResolvedFiles: any[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn().mockResolvedValue(true),
}));

const launch = jest.fn();
jest.mock('puppeteer', () => ({ launch: (...args: any[]) => launch(...args) }));

import { POST as handleDocxToPdf } from '../app/api/convert/docx-to-pdf/route';

const REAL_XML_SIZE = '<a></a>'.length + 2_000_000;

async function makeDocxUnderstatingItsSize(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', '<a>' + 'A'.repeat(2_000_000) + '</a>');
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const realSize = Buffer.alloc(4);
  realSize.writeUInt32LE(REAL_XML_SIZE);
  for (let i = buf.indexOf(realSize); i !== -1; i = buf.indexOf(realSize, i + 4)) {
    buf.writeUInt32LE(100, i);
  }
  return buf;
}

describe('docx-to-pdf route: zip that understates its uncompressed size', () => {
  it('returns 400 "not a valid DOCX" instead of a generic 500, and never launches a browser', async () => {
    const bomb = await makeDocxUnderstatingItsSize();
    mockResolvedFiles = [
      {
        name: 'liar.docx',
        size: bomb.length,
        arrayBuffer: async () => bomb.buffer.slice(bomb.byteOffset, bomb.byteOffset + bomb.byteLength),
      },
    ];
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await handleDocxToPdf(
      new NextRequest('http://localhost:3000/api/convert/docx-to-pdf', {
        method: 'POST',
        body: new FormData(),
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('The file is not a valid DOCX document.');
    expect(launch).not.toHaveBeenCalled();
  });
});
