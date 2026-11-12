const mockPage = {
  setJavaScriptEnabled: jest.fn().mockResolvedValue(undefined),
  setRequestInterception: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  setContent: jest.fn().mockResolvedValue(undefined),
  pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake-content')),
};

const mockKill = jest.fn();
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
  process: jest.fn().mockReturnValue({ kill: mockKill }),
};

jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue(mockBrowser),
}));

// The proxy's credential priming is launch's own (tests/chromium-launch.test.ts); here the
// page is just the mock page.
jest.mock('@/lib/puppeteer/launch', () => ({
  ...jest.requireActual('@/lib/puppeteer/launch'),
  openRenderPage: (browser: { newPage(): Promise<unknown> }) => browser.newPage(),
}));

jest.mock('mammoth', () => ({
  convertToHtml: jest.fn().mockResolvedValue({ value: '<p>Hello from docx</p>' }),
}));

import mammoth from 'mammoth';
import { convertDocxToPdf } from '../lib/doc/to-pdf';

function fakeRequest(url: string) {
  return {
    url: () => url,
    continue: jest.fn().mockResolvedValue(undefined),
    abort: jest.fn().mockResolvedValue(undefined),
  };
}

function requestHandler(): (request: unknown) => void {
  const call = mockPage.on.mock.calls.find(([event]) => event === 'request');
  if (!call) throw new Error('no request handler registered');
  return call[1];
}

describe('convertDocxToPdf (lib/doc/to-pdf.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPage.setContent.mockResolvedValue(undefined);
    mockPage.pdf.mockResolvedValue(Buffer.from('%PDF-fake-content'));
    mockBrowser.close.mockResolvedValue(undefined);
    mockBrowser.process.mockReturnValue({ kill: mockKill });
    (mammoth.convertToHtml as jest.Mock).mockResolvedValue({ value: '<p>Hello from docx</p>' });
  });

  it('passes the docx buffer to mammoth for HTML conversion', async () => {
    const docxBuffer = Buffer.from('fake docx bytes');

    await convertDocxToPdf({ docxBuffer });

    expect(mammoth.convertToHtml).toHaveBeenCalledWith({ buffer: docxBuffer });
  });

  it('embeds the converted HTML into the styled template before rendering', async () => {
    await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });

    const [renderedHtml] = mockPage.setContent.mock.calls[0];
    expect(renderedHtml).toContain('<p>Hello from docx</p>');
    expect(renderedHtml).toContain('class="markdown-body"');
  });

  it('returns the generated PDF buffer and closes the browser', async () => {
    const result = await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });

    expect(result).toEqual(Buffer.from('%PDF-fake-content'));
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('reports a mammoth conversion failure as a 400 client error without generating a PDF', async () => {
    (mammoth.convertToHtml as jest.Mock).mockRejectedValueOnce(new Error('corrupt docx'));

    await expect(convertDocxToPdf({ docxBuffer: Buffer.from('bad') })).rejects.toMatchObject({
      status: 400,
      message: 'The file is not a valid DOCX document.',
    });
    expect(mockPage.setContent).not.toHaveBeenCalled();
  });

  it('closes the browser when the PDF step throws', async () => {
    mockPage.pdf.mockRejectedValueOnce(new Error('Protocol error'));

    await expect(convertDocxToPdf({ docxBuffer: Buffer.from('fake') })).rejects.toThrow('Protocol error');
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('passes an explicit timeout to setContent', async () => {
    await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });

    expect(mockPage.setContent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: expect.any(Number) })
    );
  });

  it('turns JavaScript off and intercepts requests before rendering', async () => {
    await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });

    expect(mockPage.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
    expect(mockPage.setJavaScriptEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      mockPage.setContent.mock.invocationCallOrder[0],
    );
    expect(mockPage.setRequestInterception.mock.invocationCallOrder[0]).toBeLessThan(
      mockPage.setContent.mock.invocationCallOrder[0],
    );
  });

  it.each([
    'https://example.com/logo.png',
    'http://127.0.0.1:9000/',
    'file:///etc/passwd',
    'ws://example.com/',
  ])('refuses every network request, here %s', async (url) => {
    await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });
    const request = fakeRequest(url);

    requestHandler()(request);

    expect(request.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(request.continue).not.toHaveBeenCalled();
  });

  it.each(['data:image/png;base64,iVBORw0KGgo=', 'about:blank', 'blob:null/1234'])(
    'lets the inert %s through',
    async (url) => {
      await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });
      const request = fakeRequest(url);

      requestHandler()(request);

      expect(request.continue).toHaveBeenCalledTimes(1);
      expect(request.abort).not.toHaveBeenCalled();
    },
  );

  it('terminates a render that never completes rather than hanging', async () => {
    mockPage.setContent.mockImplementation(() => new Promise(() => {}));

    await expect(
      convertDocxToPdf({ docxBuffer: Buffer.from('fake'), timeoutMs: 50 })
    ).rejects.toThrow(/too long to render/i);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});
