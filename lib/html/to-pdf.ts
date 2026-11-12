import { ClientError } from '@/lib/convert/errors';
import { assertNavigableUrl, isRequestAllowed } from '@/lib/html/url-policy';
import {
  RENDER_TIMEOUT_MS,
  closeBrowser,
  ignoreHandledRequest,
  withRenderDeadline,
} from '@/lib/puppeteer/lifecycle';
import { launchBrowser, openRenderPage, wasDestinationRefused } from '@/lib/puppeteer/launch';

const REFUSED_REDIRECT_MESSAGE = 'That URL redirects to a private, internal, or non-web address.';

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

  const browser = await launchBrowser('public');

  try {
    const render = (async () => {
      const page = await openRenderPage(browser);
      await page.setViewport({ width: 1280, height: 900 });
      await page.emulateMediaType('print');

      // Interception refuses other schemes and internal names; the browser's egress proxy
      // refuses every address that is not public, including ones a name resolves to.
      let blockedMainNavigation = false;
      let mainNavigationUrl = url;
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const isMainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
        if (isMainNavigation) mainNavigationUrl = request.url();
        if (isRequestAllowed(request.url())) {
          request.continue().catch(ignoreHandledRequest);
          return;
        }
        if (isMainNavigation) blockedMainNavigation = true;
        request.abort('blockedbyclient').catch(ignoreHandledRequest);
      });

      const refusedMainNavigation = () =>
        blockedMainNavigation ||
        (mainNavigationUrl !== undefined && wasDestinationRefused(browser, mainNavigationUrl));

      if (url) {
        let response;
        try {
          response = await page.goto(url, { waitUntil: 'networkidle0', timeout: timeoutMs });
        } catch (error) {
          if (refusedMainNavigation()) throw new ClientError(REFUSED_REDIRECT_MESSAGE);
          throw error;
        }
        // A refused plain-http destination is the proxy's own 403 page, not the site's.
        if (response && wasDestinationRefused(browser, response.url())) {
          throw new ClientError(REFUSED_REDIRECT_MESSAGE);
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
