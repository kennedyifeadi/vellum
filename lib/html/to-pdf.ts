import puppeteer from 'puppeteer';
import { ClientError } from '@/lib/convert/errors';
import { assertNavigableUrl, isRequestAllowed } from '@/lib/html/url-policy';
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

  if (url) {
    await assertNavigableUrl(url);
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

      let blockedMainNavigation = false;
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        void (async () => {
          try {
            if (await isRequestAllowed(request.url())) {
              await request.continue();
              return;
            }
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
              blockedMainNavigation = true;
            }
            await request.abort('blockedbyclient');
          } catch {
            try {
              await request.abort('failed');
            } catch {
              /* request was already handled */
            }
          }
        })();
      });

      if (url) {
        try {
          await page.goto(url, { waitUntil: 'networkidle0', timeout: timeoutMs });
        } catch (error) {
          if (blockedMainNavigation) {
            throw new ClientError(
              'That URL redirects to a private, internal, or non-web address.',
            );
          }
          throw error;
        }
      } else if (htmlContent) {
        await page.setContent(htmlContent, { waitUntil: 'load', timeout: timeoutMs });
      }

      return page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
    })();

    return Buffer.from(await withRenderDeadline(render, timeoutMs));
  } finally {
    await closeBrowser(browser);
  }
}
