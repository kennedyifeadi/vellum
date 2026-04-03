import mammoth from 'mammoth'; // You'll need to install this: npm install mammoth
import puppeteer from 'puppeteer'; // You'll need to install this: npm install puppeteer

interface DocxToPdfOptions {
  docxBuffer: Buffer;
}

export async function convertDocxToPdf({
  docxBuffer,
}: DocxToPdfOptions): Promise<Buffer> {
  // 1. Convert DOCX to raw HTML using mammoth
  const { value: rawHtml } = await mammoth.convertToHtml({ buffer: docxBuffer });

  // 2. Wrap the raw HTML in a beautiful Markdown-style CSS template
  const styledHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
          font-size: 14px;
          line-height: 1.6;
          color: #24292e;
          background-color: #ffffff;
          margin: 0;
          padding: 0;
        }
        .markdown-body {
          box-sizing: border-box;
          min-width: 200px;
          max-width: 900px;
          margin: 0 auto;
          padding: 24px;
        }
        .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 {
          margin-top: 24px;
          margin-bottom: 16px;
          font-weight: 600;
          line-height: 1.25;
          color: #111827;
        }
        .markdown-body h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
        .markdown-body h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
        .markdown-body h3 { font-size: 1.25em; }
        .markdown-body h4 { font-size: 1em; }
        .markdown-body p, .markdown-body blockquote, .markdown-body ul, .markdown-body ol, .markdown-body dl, .markdown-body table, .markdown-body pre {
          margin-top: 0;
          margin-bottom: 16px;
        }
        .markdown-body hr {
          height: 0.25em;
          padding: 0;
          margin: 24px 0;
          background-color: #e1e4e8;
          border: 0;
        }
        .markdown-body blockquote {
          padding: 0 1em;
          color: #6a737d;
          border-left: 0.25em solid #dfe2e5;
        }
        .markdown-body ul, .markdown-body ol {
          padding-left: 2em;
        }
        .markdown-body table {
          display: block;
          width: 100%;
          overflow: auto;
          border-spacing: 0;
          border-collapse: collapse;
          margin-bottom: 16px;
        }
        .markdown-body table th, .markdown-body table td {
          padding: 6px 13px;
          border: 1px solid #dfe2e5;
        }
        .markdown-body table tr {
          background-color: #fff;
          border-top: 1px solid #c6cbd1;
        }
        .markdown-body table tr:nth-child(2n) {
          background-color: #f6f8fa;
        }
        .markdown-body img {
          max-width: 100%;
          box-sizing: content-box;
          background-color: #fff;
          border-radius: 6px;
        }
        .markdown-body code {
          padding: 0.2em 0.4em;
          margin: 0;
          font-size: 85%;
          background-color: rgba(27,31,35,0.05);
          border-radius: 3px;
          font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
        }
        .markdown-body pre {
          word-wrap: normal;
          padding: 16px;
          overflow: auto;
          font-size: 85%;
          line-height: 1.45;
          background-color: #f6f8fa;
          border-radius: 6px;
        }
        .markdown-body pre code {
          padding: 0;
          margin: 0;
          font-size: 100%;
          word-break: normal;
          white-space: pre;
          background: transparent;
          border: 0;
        }
        /* Important for printing/PDF generation */
        @media print {
          .markdown-body {
            padding: 0;
          }
          .markdown-body table, .markdown-body img, .markdown-body blockquote {
            page-break-inside: avoid;
          }
          .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
            page-break-after: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="markdown-body">
        ${rawHtml}
      </div>
    </body>
    </html>
  `;

  // 3. Render HTML to PDF using puppeteer
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Set the styled HTML content
  await page.setContent(styledHtml, { waitUntil: 'networkidle0' });

  // 4. Generate beautifully formatted PDF
  const pdfBuffer = await page.pdf({ 
    format: 'A4',
    margin: {
      top: '20mm',
      right: '20mm',
      bottom: '20mm',
      left: '20mm'
    },
    printBackground: true, // Ensures table zebra-striping and code blocks are rendered
  });
  
  await browser.close();

  return Buffer.from(pdfBuffer);
}