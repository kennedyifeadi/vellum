const mockPage = {
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

jest.mock('mammoth', () => ({
  convertToHtml: jest.fn().mockResolvedValue({ value: '<p>Hello from docx</p>' }),
}));

import mammoth from 'mammoth';
import { convertDocxToPdf } from '../lib/doc/to-pdf';

describe('convertDocxToPdf (lib/doc/to-pdf.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the docx buffer to mammoth for HTML conversion', async () => {
    const docxBuffer = Buffer.from('fake docx bytes');

    await convertDocxToPdf({ docxBuffer });

    expect(mammoth.convertToHtml).toHaveBeenCalledWith({ buffer: docxBuffer });
  });

  it('embeds the converted HTML into the styled template before rendering', async () => {
    await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });

    const [renderedHtml] = mockPage.setContent.mock.calls[0];
    expect(renderedHtml).toContain('<p>Hello from docx</p>');
    expect(renderedHtml).toContain('class="markdown-body"');
  });

  it('returns the generated PDF buffer and closes the browser', async () => {
    const result = await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });

    expect(result).toEqual(Buffer.from('%PDF-fake-content'));
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('propagates a mammoth conversion failure without generating a PDF', async () => {
    (mammoth.convertToHtml as jest.Mock).mockRejectedValueOnce(new Error('corrupt docx'));

    await expect(convertDocxToPdf({ docxBuffer: Buffer.from('bad') })).rejects.toThrow('corrupt docx');
    expect(mockPage.setContent).not.toHaveBeenCalled();
  });
});
