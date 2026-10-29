import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import {
  allBrowsersExited,
  leftoverChromiumProcesses,
  liveBrowserCount,
  nextHeldRender,
  peakBrowserCount,
  resetHeldRenders,
  type HeldRender,
} from './helpers/heldRenders';

// Real Chromium launches; a loaded machine can take several seconds for each.
jest.setTimeout(120_000);

let mockRenderTimeoutMs: number | undefined;

jest.mock('@/lib/puppeteer/lifecycle', () => {
  const actual = jest.requireActual('@/lib/puppeteer/lifecycle');
  return {
    ...actual,
    withRenderDeadline: (render: Promise<unknown>, timeoutMs: number) =>
      actual.withRenderDeadline(render, mockRenderTimeoutMs ?? timeoutMs),
  };
});

jest.mock('@/lib/puppeteer/launch', () => {
  const actual = jest.requireActual('@/lib/puppeteer/launch');
  return { launchBrowser: () => require('./helpers/heldRenders').launchHeldBrowser(actual.launchBrowser) };
});

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn((req: Request) => Promise.resolve(req.headers.get('x-test-user'))),
}));

jest.mock('@/lib/db/mongoose', () => ({ __esModule: true, default: jest.fn().mockResolvedValue(true) }));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { findById: jest.fn().mockResolvedValue({ plan: 'Pro' }) },
}));

jest.mock('@/lib/conversions', () => ({ saveConversionRecord: jest.fn().mockResolvedValue(true) }));

import { POST as htmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { POST as docxToPdf } from '../app/api/convert/docx-to-pdf/route';

type Handler = (req: NextRequest) => Promise<Response>;

interface Tool {
  name: string;
  handler: Handler;
  field: string;
  fileName: string;
  busyMessage: string;
  file(): Promise<Uint8Array>;
}

async function docxFile(): Promise<Uint8Array> {
  const docx = await import('docx');
  return docx.Packer.toBuffer(new docx.Document({ sections: [{ children: [new docx.Paragraph('Held render')] }] }));
}

const TOOLS: Tool[] = [
  {
    name: 'html-to-pdf',
    handler: htmlToPdf,
    field: 'html',
    fileName: 'page.html',
    busyMessage: 'HTML to PDF is busy right now. Please try again in a few seconds.',
    file: async () => new TextEncoder().encode('<h1>Held render</h1>'),
  },
  {
    name: 'docx-to-pdf',
    handler: docxToPdf,
    field: 'docx',
    fileName: 'report.docx',
    busyMessage: 'DOCX to PDF is busy right now. Please try again in a few seconds.',
    file: docxFile,
  },
];

// 500 once puppeteer sees the browser gone; on a loaded machine it can miss that, and the
// render deadline ends the render instead with its 400.
const KILLED_BROWSER_STATUSES = [500, 400];
const RENDER_TOO_LONG_MESSAGE = 'The document took too long to render and was stopped.';

beforeEach(() => {
  process.env.CLIENT_IP_HEADER = 'x-real-ip';
  mockRenderTimeoutMs = undefined;
});

afterEach(async () => {
  resetHeldRenders();
  await allBrowsersExited();
  delete process.env.CLIENT_IP_HEADER;
});

afterAll(async () => {
  expect(await leftoverChromiumProcesses()).toEqual([]);
});

async function send(tool: Tool, userId: string, file?: Uint8Array): Promise<Response> {
  const form = new FormData();
  form.append(tool.field, new File([(file ?? (await tool.file())) as BlobPart], tool.fileName));
  const req = new NextRequest(`http://localhost:3000/api/convert/${tool.name}`, { method: 'POST', body: form });
  req.headers.set('x-test-user', userId);
  return tool.handler(req);
}

/** Sends a request and waits until its render is held at setContent in a real browser. */
async function start(tool: Tool, userId: string): Promise<{ response: Promise<Response>; render: HeldRender }> {
  const response = send(tool, userId);
  let answered = false;
  response.finally(() => (answered = true)).catch(() => undefined);
  try {
    return { response, render: await nextHeldRender(() => answered) };
  } catch {
    const res = await response;
    throw new Error(`${tool.name} answered ${res.status} ${await res.text()} instead of rendering`);
  }
}

async function expectPdf(response: Promise<Response>) {
  const res = await response;
  expect(res.status).toBe(200);
  expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
}

async function expectBusy(res: Response, message: string) {
  expect(res.status).toBe(503);
  expect(res.headers.get('Retry-After')).toBe('5');
  expect(await res.json()).toEqual({ error: message });
}

/** Both of the pool's slots are free: two renders can hold a browser at once. */
async function expectBothSlotsFree(tool: Tool) {
  await allBrowsersExited();
  const first = await start(tool, 'user-a');
  const second = await start(tool, 'user-b');
  expect(liveBrowserCount()).toBe(2);
  first.render.finish();
  second.render.finish();
  await expectPdf(first.response);
  await expectPdf(second.response);
}

describe.each(TOOLS.map((tool) => [tool.name, tool] as const))('%s', (_name, tool) => {
  it('refuses a third render at once with 503 busy while two run, and never starts a third browser', async () => {
    const first = await start(tool, 'user-1');
    const second = await start(tool, 'user-2');

    await expectBusy(await send(tool, 'user-3'), tool.busyMessage);
    expect(peakBrowserCount()).toBe(2);

    first.render.finish();
    second.render.finish();
    await expectPdf(first.response);
    await expectPdf(second.response);
  });

  it('frees its slot when the render succeeds', async () => {
    const first = await start(tool, 'user-1');
    first.render.finish();
    await expectPdf(first.response);

    await expectBothSlotsFree(tool);
  });

  it('frees its slot when the render hits its deadline', async () => {
    mockRenderTimeoutMs = 3_000;

    // The deadline may fire before the render reaches its held setContent on a loaded
    // machine, so this waits for the answer rather than for the held render.
    const res = await send(tool, 'user-1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: RENDER_TOO_LONG_MESSAGE });
    resetHeldRenders();
    await allBrowsersExited();

    mockRenderTimeoutMs = undefined;
    await expectBothSlotsFree(tool);
  });

  it('frees its slot when its browser is killed mid-render', async () => {
    const { response, render } = await start(tool, 'user-1');
    render.killBrowser();

    expect(KILLED_BROWSER_STATUSES).toContain((await response).status);
    await allBrowsersExited();

    await expectBothSlotsFree(tool);
  });
});

it('shares two slots between HTML to PDF and DOCX to PDF', async () => {
  const [html, docx] = TOOLS;
  const htmlRender = await start(html, 'user-1');
  const docxRender = await start(docx, 'user-2');

  await expectBusy(await send(html, 'user-3'), html.busyMessage);
  await expectBusy(await send(docx, 'user-3'), docx.busyMessage);
  expect(peakBrowserCount()).toBe(2);

  htmlRender.render.finish();
  docxRender.render.finish();
  await expectPdf(htmlRender.response);
  await expectPdf(docxRender.response);
});

it('frees the slot of a DOCX that is refused as invalid inside the converter', async () => {
  const notDocx = new JSZip();
  notDocx.file('hello.txt', 'not a word document');
  const res = await send(TOOLS[1], 'user-1', await notDocx.generateAsync({ type: 'uint8array' }));

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'The file is not a valid DOCX document.' });
  await expectBothSlotsFree(TOOLS[1]);
});

it('frees the slot of an HTML to PDF URL refused by the egress policy', async () => {
  const req = new NextRequest('http://localhost:3000/api/convert/html-to-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': 'user-1' },
    body: JSON.stringify({ url: 'http://127.0.0.1/' }),
  });

  expect((await htmlToPdf(req)).status).toBe(400);
  await expectBothSlotsFree(TOOLS[0]);
});
