import puppeteer from 'puppeteer'; // You'll need to install this: npm install puppeteer

interface HtmlToPdfOptions {
  htmlContent?: string; // Either HTML content or a URL
  url?: string;
}

export async function convertHtmlToPdf({
  htmlContent,
  url,
}: HtmlToPdfOptions): Promise<Buffer> {
  if (!htmlContent && !url) {
    throw new Error('Either htmlContent or url must be provided.');
  }

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  if (url) {
    await page.goto(url, { waitUntil: 'networkidle0' });
  } else if (htmlContent) {
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  }

  const pdfBuffer = await page.pdf({ format: 'A4' });
  await browser.close();

  return Buffer.from(pdfBuffer);
}