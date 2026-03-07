import mammoth from 'mammoth'; // You'll need to install this: npm install mammoth
import puppeteer from 'puppeteer'; // You'll need to install this: npm install puppeteer

interface DocxToPdfOptions {
  docxBuffer: Buffer;
}

export async function convertDocxToPdf({
  docxBuffer,
}: DocxToPdfOptions): Promise<Buffer> {
  // 1. Convert DOCX to HTML using mammoth.js
  const { value: html } = await mammoth.convertToHtml({ buffer: docxBuffer });

  // 2. Render HTML to PDF using puppeteer
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Set the HTML content and wait for it to load
  await page.setContent(html, { waitUntil: 'networkidle0' });

  // Generate PDF
  const pdfBuffer = await page.pdf({ format: 'A4' });
  await browser.close();

  return Buffer.from(pdfBuffer);
}