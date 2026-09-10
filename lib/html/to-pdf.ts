import puppeteer from 'puppeteer';
import {
  RENDER_TIMEOUT_MS,
  closeBrowser,
  withRenderDeadline,
} from '@/lib/puppeteer/lifecycle';

interface HtmlToPdfOptions {
  htmlContent?: string;
  url?: string;
  timeoutMs?: number;
}

export async function convertHtmlToPdf({
  htmlContent,
  url,
  timeoutMs = RENDER_TIMEOUT_MS,
}: HtmlToPdfOptions): Promise<Buffer> {
  if (!htmlContent && !url) {
    throw new Error('Either htmlContent or url must be provided.');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const render = (async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.emulateMediaType('print');

      if (url) {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: timeoutMs });
      } else if (htmlContent) {
        await page.setContent(htmlContent, { waitUntil: 'load', timeout: timeoutMs });
      }

      return page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
    })();

    const pdfBuffer = await withRenderDeadline(render, timeoutMs);
    return Buffer.from(pdfBuffer);
  } finally {
    await closeBrowser(browser);
  }
}
