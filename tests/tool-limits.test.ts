import type { NextRequest } from 'next/server';
import { MB, formRequest, streamedUpload } from './helpers/uploadRequests';
import { MULTIPART_OVERHEAD_BYTES } from '@/lib/http/read-upload';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { TOOL_LIMITS, ToolId } from '@/lib/tool-limits';

let mockUserId: string | null = null;
let mockPlan = 'Free';

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: (id: string) => {
      const user = id ? { plan: mockPlan } : null;
      return Object.assign(Promise.resolve(user), { lean: () => Promise.resolve(user) });
    },
  },
}));

// HTML to PDF's own work would start Chromium; nothing here gets that far.
jest.mock('@/lib/html/to-pdf', () => ({
  convertHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')),
}));

jest.mock('@/lib/conversions', () => ({
  saveConversionRecord: jest.fn().mockResolvedValue(true),
  recordConversionHistory: jest.fn().mockResolvedValue(true),
}));

import { POST as compressPdf } from '../app/api/convert/compress-pdf/route';
import { POST as docxToPdf } from '../app/api/convert/docx-to-pdf/route';
import { POST as findPdf } from '../app/api/convert/find-pdf/route';
import { POST as htmlToPdf } from '../app/api/convert/html-to-pdf/route';
import { POST as imageCompress } from '../app/api/convert/image-compress/route';
import { POST as imageToPdf } from '../app/api/convert/image-to-pdf/route';
import { POST as jpgToPng } from '../app/api/convert/jpg-to-png/route';
import { POST as lockPdf } from '../app/api/convert/lock-pdf/route';
import { POST as mergePdf } from '../app/api/convert/merge-pdf/route';
import { POST as pdfToDocx } from '../app/api/convert/pdf-to-docx/route';
import { POST as splitPdf } from '../app/api/convert/split-pdf/route';
import { POST as videoCompress } from '../app/api/convert/video-compress/route';
import * as findPdfLimits from '@/lib/convert/find-pdf-limits';
import * as imageCompressLimits from '@/lib/convert/image-compress-limits';
import * as imageToPdfLimits from '@/lib/convert/image-to-pdf-limits';
import * as jpgToPngLimits from '@/lib/convert/jpg-to-png-limits';
import * as pdfToDocxLimits from '@/lib/convert/pdf-to-docx-limits';
import { assertPixelCountWithinLimit } from '@/lib/convert/image-limits';
import { encodeLimitsForPlan } from '@/lib/convert/video-compress-limits';

jest.setTimeout(60_000);

const PLANS = ['Free', 'Basic', 'Pro', 'Enterprise'];

const ROUTES: { tool: ToolId; handler: (req: NextRequest) => Promise<Response>; field: string }[] = [
  { tool: 'compress-pdf', handler: compressPdf, field: 'pdf' },
  { tool: 'split-pdf', handler: splitPdf, field: 'pdf' },
  { tool: 'lock-pdf', handler: lockPdf, field: 'pdf' },
  { tool: 'find-pdf', handler: findPdf, field: 'pdf' },
  { tool: 'merge-pdf', handler: mergePdf, field: 'pdfs' },
  { tool: 'html-to-pdf', handler: htmlToPdf, field: 'html' },
  { tool: 'docx-to-pdf', handler: docxToPdf, field: 'docx' },
  { tool: 'pdf-to-docx', handler: pdfToDocx, field: 'pdf' },
  { tool: 'image-to-pdf', handler: imageToPdf, field: 'images' },
  { tool: 'image-compress', handler: imageCompress, field: 'images' },
  { tool: 'jpg-to-png', handler: jpgToPng, field: 'images' },
  { tool: 'video-compress', handler: videoCompress, field: 'video' },
];

const IMAGE_LIMITS_MODULES = [
  ['image-to-pdf', imageToPdfLimits],
  ['image-compress', imageCompressLimits],
  ['jpg-to-png', jpgToPngLimits],
] as const;

function signInAs(plan: string) {
  mockPlan = plan;
  mockUserId = plan === 'Free' ? null : '507f1f77bcf86cd799439012';
}

function capInMessage(message: string): number {
  const match = message.match(/up to (\d+) ?MB/);
  if (!match) throw new Error(`No size cap in: ${message}`);
  return Number(match[1]);
}

beforeEach(() => {
  signInAs('Free');
});

describe.each(ROUTES)('$tool enforces the shared size cap', ({ tool, handler, field }) => {
  it.each(PLANS)('on %s: refuses just past the cap and names it', async (plan) => {
    signInAs(plan);
    const capBytes = resolvePlanLimit(plan, TOOL_LIMITS[tool].maxBytes);
    // Past the cap by the multipart allowance, so a route whose own cap were any higher
    // would read the body instead of refusing it.
    const request = streamedUpload(`http://localhost:3000/api/convert/${tool}`, field, capBytes + MULTIPART_OVERHEAD_BYTES);

    const res = await handler(request.request);

    expect(res.status).toBe(400);
    expect(capInMessage((await res.json()).error)).toBe(capBytes / MB);
    expect(request.bytesRead()).toBe(0);
  });
});

describe('merge-pdf enforces the shared file count', () => {
  it.each(PLANS)('on %s: refuses one file past the count and names it', async (plan) => {
    signInAs(plan);
    const maxFiles = resolvePlanLimit(plan, TOOL_LIMITS['merge-pdf'].maxFiles);
    const files = Array.from({ length: maxFiles + 1 }, (_, i) => ['pdfs', { bytes: '%PDF-1.7', name: `${i}.pdf` }] as [string, { bytes: string; name: string }]);

    const res = await mergePdf(formRequest('http://localhost:3000/api/convert/merge-pdf', files));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(`Your current plan allows up to ${maxFiles} files per merge.`);
  });
});

describe.each(IMAGE_LIMITS_MODULES)('%s enforces the shared image caps', (tool, limits) => {
  it.each(PLANS)('on %s: allows exactly the file count and refuses one more', (plan) => {
    const maxFiles = resolvePlanLimit(plan, TOOL_LIMITS[tool].maxFiles);

    expect(() => limits.assertFileCountWithinPlan(plan, maxFiles)).not.toThrow();
    expect(() => limits.assertFileCountWithinPlan(plan, maxFiles + 1)).toThrow(`${maxFiles}`);
  });

  it.each(PLANS)('on %s: the upload budget is the shared total', (plan) => {
    expect(limits.uploadBudgetForPlan(plan).maxBytes).toBe(resolvePlanLimit(plan, TOOL_LIMITS[tool].maxBytes));
  });
});

describe('page, line, pixel and length caps', () => {
  it.each(PLANS)('find-pdf on %s: allows exactly the page cap', (plan) => {
    const maxPages = resolvePlanLimit(plan, TOOL_LIMITS['find-pdf'].maxPages);

    expect(() => findPdfLimits.assertPageCountWithinPlan(plan, maxPages)).not.toThrow();
    expect(() => findPdfLimits.assertPageCountWithinPlan(plan, maxPages + 1)).toThrow(`${maxPages} pages`);
  });

  it.each(PLANS)('pdf-to-docx on %s: allows exactly the page and line caps', (plan) => {
    const { maxPages, maxLines } = TOOL_LIMITS['pdf-to-docx'];
    const pages = resolvePlanLimit(plan, maxPages);
    const lines = resolvePlanLimit(plan, maxLines);

    expect(() => pdfToDocxLimits.assertPageCountWithinPlan(plan, pages)).not.toThrow();
    expect(() => pdfToDocxLimits.assertPageCountWithinPlan(plan, pages + 1)).toThrow();
    expect(() => pdfToDocxLimits.assertLineCountWithinPlan(plan, lines)).not.toThrow();
    expect(() => pdfToDocxLimits.assertLineCountWithinPlan(plan, lines + 1)).toThrow();
  });

  it('images: allows exactly the megapixel cap', () => {
    const megapixels = TOOL_LIMITS['image-to-pdf'].maxMegapixelsPerImage;

    expect(() => assertPixelCountWithinLimit(1, megapixels * 1_000_000, 1)).not.toThrow();
    expect(() => assertPixelCountWithinLimit(1, megapixels * 1_000_000 + 1, 1)).toThrow(`at most ${megapixels} megapixels`);
  });

  it.each(PLANS)('video-compress on %s: the longest video is the shared length', (plan) => {
    const minutes = resolvePlanLimit(plan, TOOL_LIMITS['video-compress'].maxVideoMinutes);

    expect(encodeLimitsForPlan(plan).maxDurationSeconds).toBe(minutes * 60);
  });
});

describe('TOOL_LIMITS', () => {
  const sizesInMb = (tool: ToolId) => Object.values(TOOL_LIMITS[tool].maxBytes).map((bytes) => bytes / MB);

  it("holds each plan's values", () => {
    for (const tool of ['compress-pdf', 'split-pdf', 'lock-pdf', 'find-pdf', 'html-to-pdf', 'docx-to-pdf'] as const) {
      expect(sizesInMb(tool)).toEqual([25, 50, 100, 200]);
      expect(TOOL_LIMITS[tool].maxFiles).toEqual({ guest: 1, Basic: 1, Pro: 1, Enterprise: 1 });
    }
    expect(sizesInMb('merge-pdf')).toEqual([25, 50, 100, 250]);
    expect(TOOL_LIMITS['merge-pdf'].maxFiles).toEqual({ guest: 3, Basic: 30, Pro: 50, Enterprise: 100 });
    expect(TOOL_LIMITS['find-pdf'].maxPages).toEqual({ guest: 10, Basic: 50, Pro: 100, Enterprise: 500 });
    expect(sizesInMb('pdf-to-docx')).toEqual([5, 10, 15, 25]);
    expect(TOOL_LIMITS['pdf-to-docx'].maxPages).toEqual({ guest: 100, Basic: 200, Pro: 300, Enterprise: 500 });
    expect(TOOL_LIMITS['pdf-to-docx'].maxLines).toEqual({ guest: 8_000, Basic: 16_000, Pro: 24_000, Enterprise: 40_000 });
    for (const tool of ['image-to-pdf', 'image-compress', 'jpg-to-png'] as const) {
      expect(sizesInMb(tool)).toEqual([25, 50, 100, 200]);
      expect(TOOL_LIMITS[tool].maxFiles).toEqual({ guest: 3, Basic: 30, Pro: 50, Enterprise: 100 });
      expect(TOOL_LIMITS[tool].maxMegapixelsPerImage).toBe(50);
    }
    expect(sizesInMb('video-compress')).toEqual([50, 100, 500, 500]);
    expect(TOOL_LIMITS['video-compress'].maxVideoMinutes).toEqual({ guest: 5, Basic: 15, Pro: 30, Enterprise: 60 });
  });

  it('covers every tool that has a route', () => {
    expect(Object.keys(TOOL_LIMITS).sort()).toEqual(ROUTES.map((route) => route.tool).sort());
  });
});
