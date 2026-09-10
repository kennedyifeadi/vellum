import puppeteer from 'puppeteer';
import { ClientError } from '@/lib/convert/errors';
import { assertNavigableUrl, isRequestAllowed } from '@/lib/html/url-policy';

interface HtmlToPdfOptions {
  htmlContent?: string;
  url?: string;
}

export async function convertHtmlToPdf({
  htmlContent,
  url,
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
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      } catch (error) {
        if (blockedMainNavigation) {
          throw new ClientError(
            'That URL redirects to a private, internal, or non-web address.',
          );
        }
        throw error;
      }
    } else if (htmlContent) {
      await page.setContent(htmlContent, { waitUntil: 'load' });
    }

    return Buffer.from(
      await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      }),
    );
  } finally {
    await browser.close();
  }
}
