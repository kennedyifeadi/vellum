import puppeteer from 'puppeteer';

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

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaType('print');

  if (url) {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  } else if (htmlContent) {
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  }

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  });

  await browser.close();
  return Buffer.from(pdfBuffer);
}