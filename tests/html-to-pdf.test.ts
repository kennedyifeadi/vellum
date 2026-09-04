const mockPage = {
  setViewport: jest.fn().mockResolvedValue(undefined),
  emulateMediaType: jest.fn().mockResolvedValue(undefined),
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

describe('convertHtmlToPdf (lib/html/to-pdf.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when neither htmlContent nor url is provided', async () => {
    await expect(convertHtmlToPdf({})).rejects.toThrow(
      'Either htmlContent or url must be provided.'
    );
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });

  it('renders provided HTML content via setContent rather than navigation', async () => {
    const result = await convertHtmlToPdf({ htmlContent: '<h1>Hello</h1>' });

    expect(mockPage.setContent).toHaveBeenCalledWith('<h1>Hello</h1>', { waitUntil: 'load' });
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
});
