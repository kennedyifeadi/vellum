import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import {
  CANCELLED_MESSAGE,
  nextHeldJob,
  resetHeldJobs,
  setHeldWorkerDeadline,
  type HeldJob,
} from './helpers/heldJobs';
import { MB, streamedUpload } from './helpers/uploadRequests';

jest.setTimeout(60_000);

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn((req: Request) => Promise.resolve(req.headers.get('x-test-user'))),
}));

jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findById: jest.fn().mockResolvedValue({ plan: 'Pro' }) },
}));

jest.mock('@/models/conversion', () => ({ __esModule: true, default: { create: jest.fn().mockResolvedValue(true) } }));

jest.mock('@/lib/storage', () => ({
  getStorage: () => ({ put: jest.fn().mockResolvedValue(undefined) }),
  LocalDiskStorage: class {},
}));

jest.mock('@/lib/convert/pdf-extraction', () => ({
  ...jest.requireActual('@/lib/convert/pdf-extraction'),
  extractPdfPages: (_data: Uint8Array, options: never) =>
    require('./helpers/heldJobs').runHeldPdfExtraction('pdf-to-docx', [{ num: 1, text: 'Held page' }], options),
}));

jest.mock('@/lib/convert/find-pdf-extraction', () => ({
  ...jest.requireActual('@/lib/convert/find-pdf-extraction'),
  extractPdfTextItems: (_data: Uint8Array, options: never) =>
    require('./helpers/heldJobs').runHeldPdfExtraction('find-pdf', [[]], options),
}));

jest.mock('@/lib/image/to-pdf', () => ({
  convertImagesToPdf: ({ limits }: { limits: never }) => require('./helpers/heldJobs').runHeldImageToPdf(limits),
}));

jest.mock('@/lib/image/compress', () => ({
  ...jest.requireActual('@/lib/image/compress'),
  acceptImageToCompress: async (bytes: Buffer) => ({ format: 'jpeg', bytes }),
  compressImage: () => require('./helpers/heldJobs').holdInProcess('image-compress', Buffer.from('compressed')),
}));

jest.mock('@/lib/image/to-png', () => ({
  acceptJpeg: async (bytes: Buffer) => ({ format: 'jpeg', bytes }),
  convertJpegToPng: () => require('./helpers/heldJobs').holdInProcess('jpg-to-png', Buffer.from('png')),
}));

jest.mock('@/lib/video/compress', () => ({
  compressVideo: ({ signal }: { signal?: AbortSignal }) =>
    require('./helpers/heldJobs').holdInProcess(
      'video-compress',
      { bytes: Buffer.from('mp4'), compressed: true, format: { extension: 'mp4', contentType: 'video/mp4' } },
      signal,
    ),
}));

jest.mock('@/lib/html/to-pdf', () => ({
  convertHtmlToPdf: () => require('./helpers/heldJobs').holdInProcess('html-to-pdf', Buffer.from('%PDF-held')),
}));

jest.mock('@/lib/doc/to-pdf', () => ({
  convertDocxToPdf: () => require('./helpers/heldJobs').holdInProcess('docx-to-pdf', Buffer.from('%PDF-held')),
}));

import { POST as pdfToDocx } from '../app/api/convert/pdf-to-docx/route';
import { POST as findPdf } from '../app/api/convert/find-pdf/route';
import { POST as imageToPdf } from '../app/api/convert/image-to-pdf/route';
import { POST as imageCompress } from '../app/api/convert/image-compress/route';
import { POST as jpgToPng } from '../app/api/convert/jpg-to-png/route';
import { POST as videoCompress } from '../app/api/convert/video-compress/route';
import { POST as htmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { POST as docxToPdf } from '../app/api/convert/docx-to-pdf/route';
import { CONVERTER_BUSY_MESSAGE, PDF_TOO_COMPLEX_MESSAGE } from '@/lib/convert/pdf-to-docx-limits';
import { FIND_PDF_BUSY_MESSAGE, PDF_TOO_COMPLEX_MESSAGE as FIND_PDF_TOO_COMPLEX_MESSAGE } from '@/lib/convert/find-pdf-limits';
import { IMAGE_TO_PDF_BUSY_MESSAGE, IMAGES_TOO_COMPLEX_MESSAGE } from '@/lib/convert/image-to-pdf-limits';
import { COMPRESS_IMAGE_BUSY_MESSAGE } from '@/lib/convert/image-compress-limits';
import { JPEG_TO_PNG_BUSY_MESSAGE } from '@/lib/convert/jpg-to-png-limits';
import { COMPRESS_VIDEO_BUSY_MESSAGE } from '@/lib/convert/video-compress-limits';
import { DOCX_TO_PDF_BUSY_MESSAGE, HTML_TO_PDF_BUSY_MESSAGE } from '@/lib/puppeteer/render-jobs';

const JOB_IN_PROGRESS = 'You already have a conversion in progress. Please wait for it to finish.';

type Handler = (req: NextRequest) => Promise<Response>;
type Pool = 'pdf-worker' | 'image' | 'video' | 'browser';

interface Route {
  name: string;
  handler: Handler;
  field: string;
  fileName: string;
  pool: Pool;
  /** The held job the request starts first. */
  heldTool: string;
  busyMessage: string;
  extraFields?: [string, string][];
  /** The upload's bytes, when the route checks more than its size before the held job. */
  fileBytes?: () => Uint8Array;
}

const ROUTES: Route[] = [
  { name: 'pdf-to-docx', handler: pdfToDocx, field: 'pdf', fileName: 'a.pdf', pool: 'pdf-worker', heldTool: 'pdf-to-docx', busyMessage: CONVERTER_BUSY_MESSAGE },
  { name: 'find-pdf', handler: findPdf, field: 'pdf', fileName: 'a.pdf', pool: 'pdf-worker', heldTool: 'find-pdf', busyMessage: FIND_PDF_BUSY_MESSAGE, extraFields: [['searchTerm', 'held']] },
  { name: 'image-to-pdf', handler: imageToPdf, field: 'images', fileName: 'a.png', pool: 'image', heldTool: 'image-to-pdf:images', busyMessage: IMAGE_TO_PDF_BUSY_MESSAGE },
  { name: 'image-compress', handler: imageCompress, field: 'images', fileName: 'a.jpg', pool: 'image', heldTool: 'image-compress', busyMessage: COMPRESS_IMAGE_BUSY_MESSAGE },
  { name: 'jpg-to-png', handler: jpgToPng, field: 'images', fileName: 'a.jpg', pool: 'image', heldTool: 'jpg-to-png', busyMessage: JPEG_TO_PNG_BUSY_MESSAGE },
  { name: 'video-compress', handler: videoCompress, field: 'video', fileName: 'a.mp4', pool: 'video', heldTool: 'video-compress', busyMessage: COMPRESS_VIDEO_BUSY_MESSAGE },
  { name: 'html-to-pdf', handler: htmlToPdf, field: 'html', fileName: 'a.html', pool: 'browser', heldTool: 'html-to-pdf', busyMessage: HTML_TO_PDF_BUSY_MESSAGE },
  { name: 'docx-to-pdf', handler: docxToPdf, field: 'docx', fileName: 'a.docx', pool: 'browser', heldTool: 'docx-to-pdf', busyMessage: DOCX_TO_PDF_BUSY_MESSAGE, fileBytes: () => zipFile },
];

const route = (name: string) => ROUTES.find((candidate) => candidate.name === name)!;
const routesIn = (pool: Pool) => ROUTES.filter((candidate) => candidate.pool === pool);

interface Caller {
  user?: string;
  ip?: string;
}

const user = (id: string): Caller => ({ user: id });
const guest = (ip: string): Caller => ({ ip });
const ANONYMOUS_GUEST: Caller = {};

let onePagePdf: Uint8Array;
let zipFile: Uint8Array;

beforeAll(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  onePagePdf = await pdf.save();
  zipFile = await new JSZip().file('word/document.xml', '<w:document/>').generateAsync({ type: 'uint8array' });
});

beforeEach(() => {
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
  resetHeldJobs();
});

afterEach(() => {
  delete process.env.CLIENT_IP_HEADER;
});

function withCaller(req: NextRequest, { user: userId, ip }: Caller): NextRequest {
  if (userId) req.headers.set('x-test-user', userId);
  if (ip) req.headers.set('x-real-ip', ip);
  return req;
}

function formFor({ field, fileName, extraFields = [], fileBytes = () => onePagePdf }: Route): FormData {
  const form = new FormData();
  form.append(field, new File([fileBytes() as BlobPart], fileName));
  for (const [key, value] of extraFields) form.append(key, value);
  return form;
}

function send(target: Route, caller: Caller, signal?: AbortSignal): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/convert/${target.name}`, { method: 'POST', body: formFor(target), signal });
  return target.handler(withCaller(req, caller));
}

/**
 * A valid upload whose body stops after its first bytes until `finishUpload` is called,
 * as a slow or trickling client's would.
 */
async function sendWithHeldBody(target: Route, caller: Caller) {
  const encoded = new Response(formFor(target));
  const contentType = encoded.headers.get('content-type')!;
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  let finishUpload!: () => void;
  const uploadFinished = new Promise<void>((resolve) => (finishUpload = resolve));
  let pulls = 0;

  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(bytes.subarray(0, 64));
          return;
        }
        await uploadFinished;
        controller.enqueue(bytes.subarray(64));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const init = { method: 'POST', headers: { 'content-type': contentType }, body, duplex: 'half' };
  const req = new NextRequest(`http://localhost:3000/api/convert/${target.name}`, init as ConstructorParameters<typeof NextRequest>[1]);
  const response = target.handler(withCaller(req, caller));

  while (pulls < 2) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { response, finishUpload };
}

/** A large upload produced only as the route reads it, to show whether it was read. */
function sendStreamed({ name, handler, field }: Route, caller: Caller, sizeBytes = 8 * MB) {
  const upload = streamedUpload(`http://localhost:3000/api/convert/${name}`, field, sizeBytes);
  return { response: handler(withCaller(upload.request, caller)), bytesRead: upload.bytesRead };
}

/** Sends a request and waits until its job holds its slot. */
async function start(target: Route, caller: Caller) {
  const response = send(target, caller);
  let answered = false;
  response.finally(() => (answered = true)).catch(() => undefined);
  try {
    return { response, job: await nextHeldJob(target.heldTool, () => answered) };
  } catch {
    const res = await response;
    throw new Error(`${target.name} answered ${res.status} ${await res.text()} instead of starting`);
  }
}

/** Ends a started request's job, passing Image to PDF through its second step. */
async function finish({ response, job }: { response: Promise<Response>; job: HeldJob }) {
  job.finish();
  if (job.tool === 'image-to-pdf:images') {
    (await nextHeldJob('image-to-pdf:pdf')).finish();
  }
  return response;
}

async function expectJobInProgress(res: Response) {
  expect(res.status).toBe(429);
  expect(res.headers.get('Retry-After')).toBe('5');
  expect(await res.json()).toEqual({ error: JOB_IN_PROGRESS });
}

async function expectBusy(res: Response, message: string) {
  expect(res.status).toBe(503);
  expect(res.headers.get('Retry-After')).toBe('5');
  expect(await res.json()).toEqual({ error: message });
}

async function expectRunsToCompletion(target: Route, caller: Caller) {
  expect((await finish(await start(target, caller))).status).toBe(200);
}

describe.each([
  ['a signed-in user', user('user-1'), true],
  ['a guest with a trusted address', guest('203.0.113.1'), true],
  ['a guest without CLIENT_IP_HEADER', ANONYMOUS_GUEST, false],
])('%s with a job running', (_label, caller, trustedHeader) => {
  beforeEach(() => {
    if (!trustedHeader) delete process.env.CLIENT_IP_HEADER;
  });

  it.each(ROUTES.map((running) => [running.name, running] as const))(
    'in %s is refused a second job in every tool before its upload is read, then may run one',
    async (_name, running) => {
      const first = await start(running, caller);

      for (const second of ROUTES) {
        const refused = sendStreamed(second, caller);
        await expectJobInProgress(await refused.response);
        expect(refused.bytesRead()).toBe(0);
      }

      expect((await finish(first)).status).toBe(200);
      await expectRunsToCompletion(running, caller);
    },
  );
});

describe('callers running at once', () => {
  it.each(ROUTES.map((target) => [target.name, target] as const))(
    'in %s are each given a slot until the pool is full',
    async (_name, target) => {
      const first = await start(target, user('user-1'));
      const second = await start(target, guest('203.0.113.1'));

      await expectBusy(await send(target, user('user-3')), target.busyMessage);

      expect((await finish(first)).status).toBe(200);
      expect((await finish(second)).status).toBe(200);
    },
  );
});

describe('the guests share of a pool', () => {
  it.each(ROUTES.map((target) => [target.name, target] as const))(
    'in %s is one slot: a second guest is busy once its upload is read, a signed-in user is not',
    async (_name, target) => {
      const guestJob = await start(target, guest('203.0.113.1'));

      await expectBusy(await send(target, guest('203.0.113.2')), target.busyMessage);

      const userJob = await start(target, user('user-1'));
      expect((await finish(userJob)).status).toBe(200);
      expect((await finish(guestJob)).status).toBe(200);
      await expectRunsToCompletion(target, guest('203.0.113.2'));
    },
  );

  it.each(ROUTES.map((target) => [target.name, target] as const))(
    'in %s is not held by a guest whose upload is still arriving',
    async (_name, target) => {
      const uploading = await sendWithHeldBody(target, guest('203.0.113.1'));

      await expectRunsToCompletion(target, guest('203.0.113.2'));
      const userJob = await start(target, user('user-1'));
      expect((await finish(userJob)).status).toBe(200);

      uploading.finishUpload();
      const job = await nextHeldJob(target.heldTool);
      expect((await finish({ response: uploading.response, job })).status).toBe(200);
    },
  );

  it.each(ROUTES.map((target) => [target.name, target] as const))(
    'in %s still refuses the uploading guest a second job before reading it',
    async (_name, target) => {
      const uploading = await sendWithHeldBody(target, guest('203.0.113.1'));

      const second = sendStreamed(target, guest('203.0.113.1'));
      await expectJobInProgress(await second.response);
      expect(second.bytesRead()).toBe(0);

      uploading.finishUpload();
      const job = await nextHeldJob(target.heldTool);
      expect((await finish({ response: uploading.response, job })).status).toBe(200);
    },
  );

  it.each(ROUTES.map((target) => [target.name, target] as const))(
    'in %s frees a guest refused it, who may start another job at once',
    async (_name, target) => {
      const guestJob = await start(target, guest('203.0.113.1'));

      await expectBusy(await send(target, guest('203.0.113.2')), target.busyMessage);
      const otherPool = route(target.pool === 'video' ? 'pdf-to-docx' : 'video-compress');
      await expectRunsToCompletion(otherPool, guest('203.0.113.2'));

      expect((await finish(guestJob)).status).toBe(200);
      await expectRunsToCompletion(target, guest('203.0.113.2'));
    },
  );

  it.each(['pdf-worker', 'image', 'browser'] as const)('is shared by every tool of the %s pool', async (pool) => {
    const [held, ...others] = routesIn(pool);
    const guestJob = await start(held, guest('203.0.113.1'));

    for (const other of others) {
      await expectBusy(await send(other, guest('203.0.113.2')), other.busyMessage);
    }

    expect((await finish(guestJob)).status).toBe(200);
  });

  it('is not taken from another pool', async () => {
    const guestJob = await start(route('image-compress'), guest('203.0.113.1'));

    await expectRunsToCompletion(route('pdf-to-docx'), guest('203.0.113.2'));
    await expectRunsToCompletion(route('video-compress'), guest('203.0.113.3'));

    expect((await finish(guestJob)).status).toBe(200);
  });
});

describe('Image to PDF', () => {
  it.each(['image-to-pdf:images', 'image-to-pdf:pdf'])('is one job for its caller while in %s', async (step) => {
    const caller = guest('203.0.113.1');
    const response = send(route('image-to-pdf'), caller);
    const imagesStep = await nextHeldJob('image-to-pdf:images');
    let pdfStep: HeldJob | undefined;
    if (step === 'image-to-pdf:pdf') {
      imagesStep.finish();
      pdfStep = await nextHeldJob('image-to-pdf:pdf');
    }

    for (const other of ROUTES) {
      await expectJobInProgress(await send(other, caller));
    }

    if (pdfStep) {
      pdfStep.finish();
    } else {
      imagesStep.finish();
      (await nextHeldJob('image-to-pdf:pdf')).finish();
    }
    expect((await response).status).toBe(200);
    await expectRunsToCompletion(route('image-to-pdf'), caller);
  });

  it("holds the guests' share of both its pools until it finishes", async () => {
    const guestJob = await start(route('image-to-pdf'), guest('203.0.113.1'));

    await expectBusy(await send(route('image-compress'), guest('203.0.113.2')), COMPRESS_IMAGE_BUSY_MESSAGE);
    await expectBusy(await send(route('pdf-to-docx'), guest('203.0.113.2')), CONVERTER_BUSY_MESSAGE);
    await expectRunsToCompletion(route('pdf-to-docx'), user('user-1'));

    expect((await finish(guestJob)).status).toBe(200);
  });
});

describe('a finished job frees its caller', () => {
  const caller = guest('203.0.113.1');

  it.each(ROUTES.map((target) => [target.name, target] as const))('in %s when it fails on the input', async (_name, target) => {
    const { response, job } = await start(target, caller);
    job.finish('client-error');

    const res = await response;
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toBe(JOB_IN_PROGRESS);
    await expectRunsToCompletion(target, caller);
  });

  it.each(ROUTES.map((target) => [target.name, target] as const))('in %s when the server fails', async (_name, target) => {
    const { response, job } = await start(target, caller);
    job.finish('server-error');

    expect((await response).status).toBe(500);
    await expectRunsToCompletion(target, caller);
  });

  it.each(ROUTES.map((target) => [target.name, target] as const))(
    'in %s when the upload is refused before any work',
    async (_name, target) => {
      const refused = sendStreamed(target, caller, 600 * MB);

      expect((await refused.response).status).toBe(400);
      await expectRunsToCompletion(target, caller);
    },
  );

  it.each([
    ['pdf-to-docx', PDF_TOO_COMPLEX_MESSAGE],
    ['find-pdf', FIND_PDF_TOO_COMPLEX_MESSAGE],
    ['image-to-pdf', IMAGES_TOO_COMPLEX_MESSAGE],
  ])('in %s when its deadline kills the worker', async (name, message) => {
    setHeldWorkerDeadline(50);
    const response = send(route(name), caller);
    if (name === 'image-to-pdf') (await nextHeldJob('image-to-pdf:images')).finish();

    const res = await response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });

    setHeldWorkerDeadline(undefined);
    await expectRunsToCompletion(route(name), caller);
  });

  it('in video-compress when the client aborts', async () => {
    const abort = new AbortController();
    const response = send(route('video-compress'), caller, abort.signal);
    await nextHeldJob('video-compress');

    abort.abort();
    const res = await response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: CANCELLED_MESSAGE });

    await expectRunsToCompletion(route('video-compress'), caller);
  });
});
