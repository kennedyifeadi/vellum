const mockPage = {
  setContent: jest.fn().mockResolvedValue(undefined),
  pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake-content')),
};

const mockKill = jest.fn();
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
  process: jest.fn().mockReturnValue({ kill: mockKill }),
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
    mockPage.setContent.mockResolvedValue(undefined);
    mockPage.pdf.mockResolvedValue(Buffer.from('%PDF-fake-content'));
    mockBrowser.close.mockResolvedValue(undefined);
    mockBrowser.process.mockReturnValue({ kill: mockKill });
    (mammoth.convertToHtml as jest.Mock).mockResolvedValue({ value: '<p>Hello from docx</p>' });
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

  it('closes the browser when the PDF step throws', async () => {
    mockPage.pdf.mockRejectedValueOnce(new Error('Protocol error'));

    await expect(convertDocxToPdf({ docxBuffer: Buffer.from('fake') })).rejects.toThrow('Protocol error');
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('passes an explicit timeout to setContent', async () => {
    await convertDocxToPdf({ docxBuffer: Buffer.from('fake') });

    expect(mockPage.setContent).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: expect.any(Number) })
    );
  });

  it('terminates a render that never completes rather than hanging', async () => {
    mockPage.setContent.mockImplementation(() => new Promise(() => {}));

    await expect(
      convertDocxToPdf({ docxBuffer: Buffer.from('fake'), timeoutMs: 50 })
    ).rejects.toThrow(/too long to render/i);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });
});
