const mockBrowser = { close: jest.fn().mockResolvedValue(undefined), process: () => null };

jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue(mockBrowser),
}));

import puppeteer from 'puppeteer';
import { launchBrowser } from '@/lib/puppeteer/launch';
import { convertHtmlToPdf } from '@/lib/html/to-pdf';
import { convertDocxToPdf } from '@/lib/doc/to-pdf';

const launch = puppeteer.launch as jest.Mock;

function launchArgs(): string[] {
  return launch.mock.calls[launch.mock.calls.length - 1][0].args;
}

describe('launchBrowser', () => {
  afterEach(() => {
    delete process.env.CHROMIUM_DISABLE_SANDBOX;
    launch.mockClear();
  });

  it('keeps the Chromium sandbox on by default', async () => {
    await launchBrowser();
    expect(launchArgs()).not.toContain('--no-sandbox');
    expect(launchArgs()).not.toContain('--disable-setuid-sandbox');
  });

  it.each(['false', '1', 'yes', ''])('keeps the sandbox on when CHROMIUM_DISABLE_SANDBOX=%p', async (value) => {
    process.env.CHROMIUM_DISABLE_SANDBOX = value;
    await launchBrowser();
    expect(launchArgs()).not.toContain('--no-sandbox');
  });

  it('turns the sandbox off only when CHROMIUM_DISABLE_SANDBOX is "true"', async () => {
    process.env.CHROMIUM_DISABLE_SANDBOX = 'true';
    await launchBrowser();
    expect(launchArgs()).toEqual(expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox']));
  });

  async function docxBuffer(): Promise<Buffer> {
    const docx = await import('docx');
    return docx.Packer.toBuffer(new docx.Document({ sections: [{ children: [new docx.Paragraph('x')] }] }));
  }

  const renderers: [string, () => Promise<Buffer>][] = [
    ['HTML to PDF', () => convertHtmlToPdf({ htmlContent: '<p>x</p>' })],
    ['DOCX to PDF', async () => convertDocxToPdf({ docxBuffer: await docxBuffer() })],
  ];

  describe.each(renderers)('%s', (_name, render) => {
    beforeEach(() => {
      launch.mockResolvedValue({
        ...mockBrowser,
        newPage: jest.fn().mockRejectedValue(new Error('stop after launch')),
      });
    });

    it('launches Chromium sandboxed by default', async () => {
      await expect(render()).rejects.toThrow('stop after launch');
      expect(launchArgs()).not.toContain('--no-sandbox');
    });

    it('honours CHROMIUM_DISABLE_SANDBOX', async () => {
      process.env.CHROMIUM_DISABLE_SANDBOX = 'true';
      await expect(render()).rejects.toThrow('stop after launch');
      expect(launchArgs()).toContain('--no-sandbox');
    });
  });
});
