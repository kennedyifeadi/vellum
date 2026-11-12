import dgram from 'dgram';
import http from 'http';
import net, { type AddressInfo, type Socket } from 'net';
import type { Browser, LaunchOptions, Page } from 'puppeteer';
import { allBrowsersExited, leftoverChromiumProcesses } from './helpers/heldRenders';

// Real Chromium launches; a loaded machine can take several seconds for each.
jest.setTimeout(120_000);

// Names only these tests use. Chromium's own resolver maps both to 127.0.0.1; the policy's
// resolvers say rebind.test is public, and the proxy's maps allowed.test to the allowed server.
const REBIND_HOST = 'rebind.test';
const ALLOWED_HOST = 'allowed.test';
const PUBLIC_LOOKING_ADDRESS = '93.184.216.34';

let allowedPort = 0;
const proxyPorts: number[] = [];
// What a render's PDF waits for, so "nothing arrived" is checked only once the attempt ended.
let mockBeforePdf: ((page: Page) => Promise<void>) | undefined;

// What mammoth turns the test's DOCX into: a document that reaches for the recorder in
// every way a page can.
let mockDocxHtml = '';
jest.mock('mammoth', () => ({ convertToHtml: jest.fn(async () => ({ value: mockDocxHtml })) }));

jest.mock('dns/promises', () => ({
  lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

// The proxy reaches only the allowed test server: a public-looking address is refused here
// rather than connected to, so these tests never leave the machine. The launch's own options
// (a DOCX render's refuseAll) are kept.
jest.mock('@/lib/puppeteer/egress-proxy', () => {
  const actual = jest.requireActual('@/lib/puppeteer/egress-proxy');
  return {
    ...actual,
    startEgressProxy: async (options: object) => {
      const proxy = await actual.startEgressProxy({
        ...options,
        resolve: async (hostname: string) =>
          ({ 'allowed.test': ['127.0.0.1'], 'rebind.test': ['93.184.216.34'] })[hostname] ?? [],
        isDestinationAllowed: (address: string, port: number) => address === '127.0.0.1' && port === allowedPort,
      });
      proxyPorts.push(proxy.port);
      return proxy;
    },
  };
});

// Each browser is counted for the leftover-process check, and its PDF waits for the test's
// mockBeforePdf, so "nothing arrived" is never a race.
jest.mock('@/lib/puppeteer/launch', () => {
  const actual = jest.requireActual('@/lib/puppeteer/launch');
  const { launchTrackedBrowser } = require('./helpers/heldRenders');
  return {
    ...actual,
    launchBrowser: async (...args: unknown[]) => {
      const browser: Browser = await launchTrackedBrowser(() => actual.launchBrowser(...args));
      const newPage = browser.newPage.bind(browser);
      browser.newPage = async () => {
        const page: Page = await newPage();
        const pdf = page.pdf.bind(page);
        page.pdf = async (options) => {
          await mockBeforePdf?.(page);
          return pdf(options);
        };
        return page;
      };
      return browser;
    },
  };
});

import puppeteer from 'puppeteer';
import { convertHtmlToPdf } from '@/lib/html/to-pdf';
import { convertDocxToPdf } from '@/lib/doc/to-pdf';
import { DESTINATION_REFUSED_MESSAGE } from '@/lib/html/url-policy';

interface Recorder {
  port: number;
  /** Every TCP connection and UDP datagram that reached the server. */
  received: string[];
  close(): Promise<void>;
}

/** A server on 127.0.0.1 that records every TCP connection and UDP datagram on its port. */
async function startRecorder(): Promise<Recorder> {
  const received: string[] = [];
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    received.push(`${req.method} ${req.url} host=${req.headers.host}`);
    res.end();
  });
  server.on('connection', (socket: Socket) => {
    received.push('tcp connection');
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket) => {
    received.push(`upgrade ${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const udp = dgram.createSocket('udp4');
  udp.on('message', () => received.push('udp datagram'));
  await new Promise<void>((resolve) => udp.bind(port, '127.0.0.1', resolve));

  return {
    port,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => udp.close(() => resolve())),
      ]);
    },
  };
}

/** The allowed server: a page with an image, and the image, recording each request. */
async function startAllowedServer(): Promise<{ port: number; requests: string[]; close(): Promise<void> }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.url} host=${req.headers.host}`);
    if (req.url === '/page') {
      res.setHeader('content-type', 'text/html');
      res.end(`<h1>Allowed page</h1><img src="/pixel.svg">`);
      return;
    }
    res.setHeader('content-type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let recorder: Recorder;
let allowed: Awaited<ReturnType<typeof startAllowedServer>>;
let launchSpy: jest.SpyInstance;

beforeAll(async () => {
  allowed = await startAllowedServer();
  allowedPort = allowed.port;

  const realLaunch = puppeteer.launch.bind(puppeteer);
  launchSpy = jest.spyOn(puppeteer, 'launch').mockImplementation((options?: LaunchOptions) =>
    realLaunch({
      ...options,
      args: [
        ...(options?.args ?? []),
        `--host-resolver-rules=MAP ${REBIND_HOST} 127.0.0.1, MAP ${ALLOWED_HOST} 127.0.0.1`,
      ],
    }),
  );
});

beforeEach(async () => {
  recorder = await startRecorder();
  mockBeforePdf = undefined;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  (console.warn as jest.Mock).mockRestore();
  await recorder.close();
  await allBrowsersExited();
});

afterAll(async () => {
  launchSpy.mockRestore();
  await allowed.close();
  expect(await leftoverChromiumProcesses()).toEqual([]);
  for (const port of proxyPorts) {
    expect(await isListening(port)).toBe(false);
  }
});

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect({ host: '127.0.0.1', port });
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}

async function expectPdf(render: Promise<Buffer>): Promise<void> {
  expect((await render).subarray(0, 5).toString()).toBe('%PDF-');
}

/** A page whose script sets `egressAttemptDone` once its own network attempt has ended. */
function attemptPage(script: string): string {
  mockBeforePdf = async (page) => {
    await page.waitForFunction(() => (window as { egressAttemptDone?: boolean }).egressAttemptDone, {
      timeout: 60_000,
    });
  };
  return `<h1>Egress attempt</h1><script>window.egressAttemptDone = false; ${script}</script>`;
}

function proxyRefusalsLogged(): string {
  return (console.warn as jest.Mock).mock.calls.map((args) => args.join(' ')).join('\n');
}

/** Waits until `done` holds, checking again every 50 ms. */
async function until(done: () => boolean): Promise<void> {
  while (!done()) await new Promise((resolve) => setTimeout(resolve, 50));
}

function withoutFavicon(requests: string[]): string[] {
  return requests.filter((request) => !request.startsWith('/favicon.ico'));
}

describe('an uploaded page cannot reach a local server', () => {
  it('through an image', async () => {
    await expectPdf(convertHtmlToPdf({ htmlContent: `<img src="http://127.0.0.1:${recorder.port}/pixel.png">` }));
    expect(recorder.received).toEqual([]);
  });

  it('through a WebSocket', async () => {
    const html = attemptPage(`
      const ws = new WebSocket('ws://127.0.0.1:${recorder.port}/');
      ws.onopen = ws.onerror = ws.onclose = () => { window.egressAttemptDone = true; };
    `);

    await expectPdf(convertHtmlToPdf({ htmlContent: html }));
    expect(recorder.received).toEqual([]);
  });

  // Chromium reports a failed ICE server only after about 40 seconds, past the render deadline,
  // so the PDF waits instead for the TCP TURN attempt to end: at the recorder (no proxy) or at
  // the proxy's refusal. Chromium on Windows sends no STUN or TURN datagrams to 127.0.0.1 even
  // without a proxy, so there only the TCP path is observable.
  it('through WebRTC candidate gathering', async () => {
    const target = `127.0.0.1:${recorder.port}`;
    mockBeforePdf = () => until(() => recorder.received.length > 0 || proxyRefusalsLogged().includes(target));
    const html = `<h1>WebRTC</h1><script>
      const pc = new RTCPeerConnection({
        iceServers: [{
          urls: ['stun:${target}', 'turn:${target}?transport=udp', 'turn:${target}?transport=tcp'],
          username: 'user',
          credential: 'secret',
        }],
      });
      pc.createDataChannel('x');
      pc.createOffer().then((offer) => pc.setLocalDescription(offer));
    </script>`;

    await expectPdf(convertHtmlToPdf({ htmlContent: html }));
    expect(recorder.received).toEqual([]);
  });

  it("through a name only Chromium's resolver maps to it", async () => {
    await expectPdf(
      convertHtmlToPdf({ htmlContent: `<img src="http://${REBIND_HOST}:${recorder.port}/pixel.png">` }),
    );
    expect(recorder.received).toEqual([]);
  });
});

describe('a URL render cannot reach a local server', () => {
  it("through a name only Chromium's resolver maps to it", async () => {
    await expect(convertHtmlToPdf({ url: `http://${REBIND_HOST}:${recorder.port}/` })).rejects.toThrow(
      DESTINATION_REFUSED_MESSAGE,
    );
    expect(recorder.received).toEqual([]);
  });

  it("checks the address the proxy's own resolver gave, not Chromium's", async () => {
    await convertHtmlToPdf({ url: `http://${REBIND_HOST}:${recorder.port}/` }).catch(() => undefined);

    const logged = proxyRefusalsLogged();
    expect(logged).toContain(PUBLIC_LOOKING_ADDRESS);
    expect(logged).not.toContain('127.0.0.1');
  });
});

describe('an allowed destination is still reached', () => {
  it('from an uploaded page', async () => {
    allowed.requests.length = 0;

    await expectPdf(convertHtmlToPdf({ htmlContent: `<img src="http://${ALLOWED_HOST}:${allowed.port}/pixel.svg">` }));

    expect(withoutFavicon(allowed.requests)).toEqual([`/pixel.svg host=${ALLOWED_HOST}:${allowed.port}`]);
  });

  it('in URL mode, with its sub-resources', async () => {
    allowed.requests.length = 0;

    await expectPdf(convertHtmlToPdf({ url: `http://${ALLOWED_HOST}:${allowed.port}/page` }));

    expect(withoutFavicon(allowed.requests)).toEqual([
      `/page host=${ALLOWED_HOST}:${allowed.port}`,
      `/pixel.svg host=${ALLOWED_HOST}:${allowed.port}`,
    ]);
  });
});

describe('a DOCX render', () => {
  it('reaches nothing its HTML references, not even a destination HTML renders may reach', async () => {
    allowed.requests.length = 0;
    const origin = `http://127.0.0.1:${recorder.port}`;
    mockDocxHtml = `
      <p>Document</p>
      <img src="${origin}/image.png">
      <link rel="stylesheet" href="${origin}/style.css">
      <iframe src="${origin}/frame"></iframe>
      <img src="http://${REBIND_HOST}:${recorder.port}/named.png">
      <iframe src="http://${ALLOWED_HOST}:${allowed.port}/page"></iframe>
      <script>fetch('${origin}/script'); new WebSocket('ws://127.0.0.1:${recorder.port}/');</script>`;

    await expectPdf(convertDocxToPdf({ docxBuffer: Buffer.from('mammoth is mocked') }));

    expect(recorder.received).toEqual([]);
    expect(allowed.requests).toEqual([]);
  });
});
