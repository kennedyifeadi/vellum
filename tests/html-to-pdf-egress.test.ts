const mockLookup = jest.fn();
jest.mock('dns/promises', () => ({ lookup: (...args: any[]) => mockLookup(...args) }));

const mainFrame = { name: 'main' };

const mockPage = {
  setViewport: jest.fn().mockResolvedValue(undefined),
  emulateMediaType: jest.fn().mockResolvedValue(undefined),
  setRequestInterception: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  mainFrame: jest.fn(() => mainFrame),
  goto: jest.fn().mockResolvedValue(undefined),
  setContent: jest.fn().mockResolvedValue(undefined),
  pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake-content')),
};

const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue(mockBrowser),
}));

import puppeteer from 'puppeteer';
import { convertHtmlToPdf } from '../lib/html/to-pdf';
import { ClientError } from '../lib/convert/errors';

function fakeRequest(url: string, opts: { navigation?: boolean; frame?: unknown } = {}) {
  return {
    url: () => url,
    isNavigationRequest: () => opts.navigation ?? false,
    frame: () => opts.frame ?? null,
    continue: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn().mockResolvedValue(undefined),
  };
}

function registeredRequestHandler(): (req: unknown) => void {
  const call = mockPage.on.mock.calls.find(([event]) => event === 'request');
  if (!call) throw new Error('no request handler registered');
  return call[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('convertHtmlToPdf blocks disallowed URLs before navigating', () => {
  it.each([
    'file:///etc/passwd',
    'file:///C:/Windows/win.ini',
    'data:text/html,<h1>x</h1>',
    'http://127.0.0.1:8080/api/auth/me',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://[::1]/',
  ])('rejects %s without launching a browser', async (url) => {
    await expect(convertHtmlToPdf({ url })).rejects.toBeInstanceOf(ClientError);
    expect(puppeteer.launch).not.toHaveBeenCalled();
    expect(mockPage.goto).not.toHaveBeenCalled();
  });
});

describe('convertHtmlToPdf still performs allowed conversions', () => {
  it('navigates to a public https URL', async () => {
    await convertHtmlToPdf({ url: 'https://example.com/report' });

    expect(mockPage.goto).toHaveBeenCalledWith(
      'https://example.com/report',
      expect.objectContaining({ waitUntil: 'networkidle0' }),
    );
    expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
  });

  it('renders a self-contained HTML document via setContent', async () => {
    const result = await convertHtmlToPdf({ htmlContent: '<h1>Invoice</h1>' });

    expect(mockPage.setContent).toHaveBeenCalledWith('<h1>Invoice</h1>', { waitUntil: 'load' });
    expect(mockPage.goto).not.toHaveBeenCalled();
    expect(result).toEqual(Buffer.from('%PDF-fake-content'));
  });

  it('closes the browser on the success path', async () => {
    await convertHtmlToPdf({ htmlContent: '<p>hi</p>' });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});

describe('egress policy on every request (redirects and sub-resources)', () => {
  it('aborts a sub-resource request to file://', async () => {
    await convertHtmlToPdf({ htmlContent: '<img src="x">' });
    const handler = registeredRequestHandler();

    const req = fakeRequest('file:///etc/passwd');
    handler(req);
    await flush();

    expect(req.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(req.continue).not.toHaveBeenCalled();
  });

  it('aborts a sub-resource request to a loopback address', async () => {
    await convertHtmlToPdf({ htmlContent: '<iframe src="x"></iframe>' });
    const handler = registeredRequestHandler();

    const req = fakeRequest('http://127.0.0.1:9000/api/secret');
    handler(req);
    await flush();

    expect(req.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(req.continue).not.toHaveBeenCalled();
  });

  it('lets an inert data: sub-resource through', async () => {
    await convertHtmlToPdf({ htmlContent: '<img src="x">' });
    const handler = registeredRequestHandler();

    const req = fakeRequest('data:image/png;base64,iVBORw0KGgo=');
    handler(req);
    await flush();

    expect(req.continue).toHaveBeenCalledTimes(1);
    expect(req.abort).not.toHaveBeenCalled();
  });

  it('lets an allowed public sub-resource through', async () => {
    mockLookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
    await convertHtmlToPdf({ htmlContent: '<img src="x">' });
    const handler = registeredRequestHandler();

    const req = fakeRequest('https://cdn.example.com/logo.png');
    handler(req);
    await flush();

    expect(req.continue).toHaveBeenCalledTimes(1);
    expect(req.abort).not.toHaveBeenCalled();
  });

  it('surfaces a ClientError when a redirect drives the main navigation to a blocked host', async () => {
    mockPage.goto.mockImplementationOnce(async () => {
      const handler = registeredRequestHandler();
      const redirected = fakeRequest('http://127.0.0.1:9000/', {
        navigation: true,
        frame: mainFrame,
      });
      handler(redirected);
      await flush();
      throw new Error('net::ERR_ABORTED');
    });

    await expect(convertHtmlToPdf({ url: 'https://start.example.com/go' })).rejects.toBeInstanceOf(
      ClientError,
    );
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
