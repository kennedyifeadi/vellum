import { NextRequest } from 'next/server';
import { NOT_MULTIPART_MESSAGE, UNREADABLE_UPLOAD_MESSAGE } from '@/lib/http/read-upload';
import { INVALID_DRIVE_SELECTION_MESSAGE } from '@/lib/drive/resolveFiles';
import { formRequest, rawRequest } from './helpers/uploadRequests';

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockResolvedValue('507f1f77bcf86cd799439011'),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => {
  const user = { plan: 'Basic' };
  return {
    __esModule: true,
    default: { findById: jest.fn(() => Object.assign(Promise.resolve(user), { lean: () => Promise.resolve(user) })) },
  };
});

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: jest.fn(), aggregate: jest.fn().mockResolvedValue([]) },
}));

jest.mock('@/models/userDocument', () => ({
  __esModule: true,
  default: { create: jest.fn(), aggregate: jest.fn().mockResolvedValue([]) },
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn(),
  recordConversionHistory: jest.fn(),
}));

import { POST as compressPdf } from '../app/api/convert/compress-pdf/route';
import { POST as docxToPdf } from '../app/api/convert/docx-to-pdf/route';
import { POST as findPdf } from '../app/api/convert/find-pdf/route';
import { POST as htmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { POST as imageCompress } from '../app/api/convert/image-compress/route';
import { POST as imageToPdf } from '../app/api/convert/image-to-pdf/route';
import { POST as jpgToPng } from '../app/api/convert/jpg-to-png/route';
import { POST as lockPdf } from '../app/api/convert/lock-pdf/route';
import { POST as mergePdf } from '../app/api/convert/merge-pdf/route';
import { POST as pdfToDocx } from '../app/api/convert/pdf-to-docx/route';
import { POST as splitPdf } from '../app/api/convert/split-pdf/route';
import { POST as videoCompress } from '../app/api/convert/video-compress/route';
import { POST as uploadDocuments } from '../app/api/documents/upload/route';

interface MultipartRoute {
  name: string;
  handler: (req: NextRequest) => Promise<Response>;
  field: string;
  /** Text fields the route reads, with a valid value for each. */
  textFields: Record<string, string>;
  drive: boolean;
}

const ROUTES: MultipartRoute[] = [
  { name: 'compress-pdf', handler: compressPdf, field: 'pdf', textFields: { level: 'low' }, drive: true },
  { name: 'split-pdf', handler: splitPdf, field: 'pdf', textFields: { startPage: '1', endPage: '1', splitEvery: 'false' }, drive: true },
  { name: 'lock-pdf', handler: lockPdf, field: 'pdf', textFields: { password: 'secret-1' }, drive: true },
  { name: 'find-pdf', handler: findPdf, field: 'pdf', textFields: { searchTerm: 'hello' }, drive: true },
  { name: 'merge-pdf', handler: mergePdf, field: 'pdfs', textFields: {}, drive: true },
  { name: 'pdf-to-docx', handler: pdfToDocx, field: 'pdf', textFields: {}, drive: true },
  { name: 'html-to-pdf', handler: htmlToPdf, field: 'html', textFields: {}, drive: true },
  { name: 'docx-to-pdf', handler: docxToPdf, field: 'docx', textFields: {}, drive: true },
  { name: 'image-to-pdf', handler: imageToPdf, field: 'images', textFields: {}, drive: true },
  { name: 'image-compress', handler: imageCompress, field: 'images', textFields: { level: 'low' }, drive: true },
  { name: 'jpg-to-png', handler: jpgToPng, field: 'images', textFields: {}, drive: true },
  { name: 'video-compress', handler: videoCompress, field: 'video', textFields: { quality: 'High', resolution: '720p' }, drive: true },
  { name: 'documents/upload', handler: uploadDocuments, field: 'files', textFields: {}, drive: false },
];

const URL = 'http://localhost:3000/api/test';
const BOUNDARY = 'caller-mistake-boundary';
// HTML to PDF takes a JSON body with a URL as well as an upload.
const HTML_REQUEST_MESSAGE = 'Send an HTML file as multipart/form-data, or JSON with a "url".';

async function expect400(res: Response, message: string) {
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe(message);
}

const textField = (route: MultipartRoute): [string, string][] => Object.entries(route.textFields);

describe.each(ROUTES)('$name caller mistakes', (route) => {
  const notMultipart = route.name === 'html-to-pdf' ? HTML_REQUEST_MESSAGE : NOT_MULTIPART_MESSAGE;

  it('answers a JSON body with a 400', async () => {
    const res = await route.handler(rawRequest(URL, JSON.stringify({ [route.field]: 'x' }), 'application/json'));

    await expect400(res, route.name === 'html-to-pdf' ? 'No URL provided.' : notMultipart);
  });

  it.each([
    ['an empty POST', null, undefined],
    ['a url-encoded form', `${route.field}=x`, 'application/x-www-form-urlencoded'],
    ['plain text', 'hello', 'text/plain'],
  ])('answers %s with a 400', async (_label, body, contentType) => {
    await expect400(await route.handler(rawRequest(URL, body, contentType)), notMultipart);
  });

  it('answers a malformed multipart body with a 400', async () => {
    const res = await route.handler(rawRequest(URL, 'garbage', 'multipart/form-data; boundary=xyz'));

    await expect400(res, UNREADABLE_UPLOAD_MESSAGE);
  });

  it('answers text sent in the file field with a 400', async () => {
    const res = await route.handler(formRequest(URL, [[route.field, 'not a file'], ...textField(route)]));

    await expect400(res, `The "${route.field}" field must be a file.`);
  });

  it('answers a file without a name with a 400', async () => {
    // What a browser sends for a nameless file; Node's FormData would send text instead.
    const body = [
      `--${BOUNDARY}`,
      `Content-Disposition: form-data; name="${route.field}"; filename=""`,
      'Content-Type: application/octet-stream',
      '',
      'data',
      `--${BOUNDARY}--`,
      '',
    ].join('\r\n');
    const res = await route.handler(rawRequest(URL, body, `multipart/form-data; boundary=${BOUNDARY}`));

    await expect400(res, 'Every uploaded file must have a name.');
  });

  if (route.drive) {
    it.each([
      ['not JSON', 'not json'],
      ['missing its id', JSON.stringify({ accessToken: 'token' })],
      ['carrying a path as its id', JSON.stringify({ id: '../about', accessToken: 'token' })],
    ])('answers a Google Drive selection %s with a 400', async (_label, selection) => {
      const res = await route.handler(formRequest(URL, [['googleDriveFiles', selection], ...textField(route)]));

      await expect400(res, INVALID_DRIVE_SELECTION_MESSAGE);
    });
  }

  const textFieldNames = Object.keys(route.textFields);
  if (textFieldNames.length > 0) {
    it.each(textFieldNames)('answers a file sent as the %s field with a 400', async (name) => {
      const fields = textField(route).filter(([key]) => key !== name);
      const res = await route.handler(
        formRequest(URL, [[route.field, { bytes: 'data', name: 'upload.bin' }], [name, { bytes: 'x', name: `${name}.txt` }], ...fields]),
      );

      await expect400(res, `The "${name}" field must be text, not a file.`);
    });
  }
});

describe('html-to-pdf URL mode caller mistakes', () => {
  it.each([
    ['JSON that does not parse', '{"url":', 'application/json'],
    ['a JSON array', '[]', 'application/json'],
    ['a JSON null', 'null', 'application/json'],
  ])('answers %s with a 400', async (_label, body, contentType) => {
    await expect400(await htmlToPdf(rawRequest(URL, body, contentType)), HTML_REQUEST_MESSAGE);
  });

  it.each([
    ['a number', 5],
    ['an object', { href: 'https://example.com' }],
    ['an empty string', ''],
  ])('answers a url that is %s with a 400', async (_label, url) => {
    const res = await htmlToPdf(rawRequest(URL, JSON.stringify({ url }), 'application/json'));

    await expect400(res, 'No URL provided.');
  });

  it('answers an empty HTML file with a 400', async () => {
    const res = await htmlToPdf(formRequest(URL, [['html', { bytes: '', name: 'empty.html' }]]));

    await expect400(res, 'The HTML file is empty.');
  });
});
