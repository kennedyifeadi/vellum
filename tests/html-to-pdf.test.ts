const mockPage = {
  setViewport: jest.fn().mockResolvedValue(undefined),
  emulateMediaType: jest.fn().mockResolvedValue(undefined),
  goto: jest.fn().mockResolvedValue(undefined),
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

import puppeteer from 'puppeteer';
import { convertHtmlToPdf } from '../lib/html/to-pdf';

describe('convertHtmlToPdf (lib/html/to-pdf.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPage.setContent.mockResolvedValue(undefined);
    mockPage.goto.mockResolvedValue(undefined);
    mockPage.pdf.mockResolvedValue(Buffer.from('%PDF-fake-content'));
    mockBrowser.close.mockResolvedValue(undefined);
    mockBrowser.process.mockReturnValue({ kill: mockKill });
  });

  it('throws when neither htmlContent nor url is provided', async () => {
    await expect(convertHtmlToPdf({})).rejects.toThrow(
      'Either htmlContent or url must be provided.'
    );
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });

  it('renders provided HTML content via setContent rather than navigation', async () => {
    const result = await convertHtmlToPdf({ htmlContent: '<h1>Hello</h1>' });

    expect(mockPage.setContent).toHaveBeenCalledWith(
      '<h1>Hello</h1>',
      expect.objectContaining({ waitUntil: 'load', timeout: expect.any(Number) })
    );
    expect(mockPage.goto).not.toHaveBeenCalled();
    expect(result).toEqual(Buffer.from('%PDF-fake-content'));
  });

  it('navigates to a URL instead of using setContent when a url is provided', async () => {
    await convertHtmlToPdf({ url: 'https://example.com' });

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
      waitUntil: 'networkidle0',
    }));
    expect(mockPage.setContent).not.toHaveBeenCalled();
  });

  it('closes the browser even though the PDF was generated successfully', async () => {
    await convertHtmlToPdf({ htmlContent: '<p>content</p>' });

    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('prefers url over htmlContent when both are supplied', async () => {
    await convertHtmlToPdf({ htmlContent: '<p>ignored</p>', url: 'https://example.com/page' });

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/page', expect.anything());
    expect(mockPage.setContent).not.toHaveBeenCalled();
  });

  it('closes the browser when rendering throws part-way through', async () => {
    mockPage.pdf.mockRejectedValueOnce(new Error('Protocol error: Target closed'));

    await expect(convertHtmlToPdf({ htmlContent: '<p>x</p>' })).rejects.toThrow('Target closed');
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('closes the browser when navigation rejects', async () => {
    mockPage.goto.mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'));

    await expect(convertHtmlToPdf({ url: 'https://nope.invalid' })).rejects.toThrow();
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('terminates a render that never completes and rejects rather than hanging', async () => {
    mockPage.setContent.mockImplementation(() => new Promise(() => {}));

    await expect(
      convertHtmlToPdf({ htmlContent: '<script>while(true){}</script>', timeoutMs: 50 })
    ).rejects.toThrow(/too long to render/i);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('force-kills the process when a graceful close hangs after a failed render', async () => {
    jest.useFakeTimers();
    try {
      mockPage.pdf.mockRejectedValueOnce(new Error('boom'));
      mockBrowser.close.mockImplementationOnce(() => new Promise(() => {}));

      const call = convertHtmlToPdf({ htmlContent: '<p>x</p>', timeoutMs: 50 });
      const assertion = expect(call).rejects.toThrow('boom');
      await jest.advanceTimersByTimeAsync(10_000);
      await assertion;

      expect(mockKill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      jest.useRealTimers();
    }
  });
});
