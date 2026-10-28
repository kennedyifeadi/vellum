import type { PlanTierValues } from '@/lib/plan-limits';

// The one list of what each tool accepts on each plan. The routes and lib/convert's
// limits modules enforce these values; the upload screen, Help and pricing show them.
// It imports nothing that runs on the server, so the client bundle can read it.

export const BYTES_PER_MB = 1024 * 1024;
const MB = BYTES_PER_MB;

export type ToolId =
  | 'compress-pdf'
  | 'split-pdf'
  | 'lock-pdf'
  | 'find-pdf'
  | 'merge-pdf'
  | 'html-to-pdf'
  | 'docx-to-pdf'
  | 'pdf-to-docx'
  | 'image-to-pdf'
  | 'image-compress'
  | 'jpg-to-png'
  | 'video-compress';

export interface ToolLimits {
  /** The upload cap: of each file (`file`) or of all the files in one request (`request`). */
  maxBytes: PlanTierValues<number>;
  sizeApplies: 'file' | 'request';
  maxFiles: PlanTierValues<number>;
  maxPages?: PlanTierValues<number>;
  /** Lines of extracted text per document. */
  maxLines?: PlanTierValues<number>;
  maxMegapixelsPerImage?: number;
  /** The longest video accepted at any resolution; most are refused sooner, see `VIDEO_LENGTH_NOTE`. */
  maxVideoMinutes?: PlanTierValues<number>;
}

const ONE_FILE: PlanTierValues<number> = { guest: 1, Basic: 1, Pro: 1, Enterprise: 1 };

const PDF_TOOL_SIZE: PlanTierValues<number> = {
  guest: 25 * MB,
  Basic: 50 * MB,
  Pro: 100 * MB,
  Enterprise: 200 * MB,
};

const SINGLE_PDF_TOOL: ToolLimits = { maxBytes: PDF_TOOL_SIZE, sizeApplies: 'file', maxFiles: ONE_FILE };

// Shared by Image to PDF, Compress Image and JPEG to PNG. The size is the sum of the
// images in one request. Pixels are read from each image's header, so that cap is checked
// before any pixel is decoded: an image's cost follows its pixels, not its bytes (a
// flat-colour 268-megapixel PNG is under 800 KB and took 1.5 GB to re-encode).
export const IMAGE_TOOL_LIMITS = {
  maxBytes: PDF_TOOL_SIZE,
  sizeApplies: 'request',
  maxFiles: { guest: 3, Basic: 30, Pro: 50, Enterprise: 100 },
  maxMegapixelsPerImage: 50,
} satisfies ToolLimits;

export const TOOL_LIMITS = {
  'compress-pdf': SINGLE_PDF_TOOL,
  'split-pdf': SINGLE_PDF_TOOL,
  'lock-pdf': SINGLE_PDF_TOOL,
  'html-to-pdf': SINGLE_PDF_TOOL,
  'docx-to-pdf': SINGLE_PDF_TOOL,
  'find-pdf': {
    ...SINGLE_PDF_TOOL,
    maxPages: { guest: 10, Basic: 50, Pro: 100, Enterprise: 500 },
  },
  'merge-pdf': {
    maxBytes: { guest: 25 * MB, Basic: 50 * MB, Pro: 100 * MB, Enterprise: 250 * MB },
    sizeApplies: 'request',
    maxFiles: { guest: 3, Basic: 30, Pro: 50, Enterprise: 100 },
  },
  // Lower than the other PDF tools because the DOCX build runs on the request's own event
  // loop. The pages and lines are sized by measurement on ordinary text: the largest a
  // tier allows convert in about 1s (guest) to 4s (Enterprise); see #81. Every line
  // becomes a paragraph, and a page cap alone does not bound them: a dense page carries
  // far more than the ~80 lines these allow per permitted page.
  'pdf-to-docx': {
    maxBytes: { guest: 5 * MB, Basic: 10 * MB, Pro: 15 * MB, Enterprise: 25 * MB },
    sizeApplies: 'file',
    maxFiles: ONE_FILE,
    maxPages: { guest: 100, Basic: 200, Pro: 300, Enterprise: 500 },
    maxLines: { guest: 8_000, Basic: 16_000, Pro: 24_000, Enterprise: 40_000 },
  },
  'image-to-pdf': IMAGE_TOOL_LIMITS,
  'image-compress': IMAGE_TOOL_LIMITS,
  'jpg-to-png': IMAGE_TOOL_LIMITS,
  // Enterprise matches Pro. It was held there by proxy.ts's 520 MB body clone, which no
  // longer applies to uploads; raising it is a separate decision.
  'video-compress': {
    maxBytes: { guest: 50 * MB, Basic: 100 * MB, Pro: 500 * MB, Enterprise: 500 * MB },
    sizeApplies: 'file',
    maxFiles: ONE_FILE,
    maxVideoMinutes: { guest: 5, Basic: 15, Pro: 30, Enterprise: 60 },
  },
} satisfies Record<ToolId, ToolLimits>;

export const TOOL_IDS = Object.keys(TOOL_LIMITS) as ToolId[];

export function isToolId(id: string): id is ToolId {
  return Object.hasOwn(TOOL_LIMITS, id);
}

// The server refuses most videos well before `maxVideoMinutes`: its encode time budget
// depends on the resolution and frame rate, so only the server can name the real length.
export const VIDEO_LENGTH_NOTE =
  'How long a video can be depends on its resolution and frame rate, up to the length shown for your plan. ' +
  'If a video is too long to compress, you will be told how long it can be.';

/** The per-plan sizes pricing shows: the general document tools' cap and the video cap. */
export const HEADLINE_LIMITS = {
  documents: PDF_TOOL_SIZE,
  video: TOOL_LIMITS['video-compress'].maxBytes,
  batchFiles: IMAGE_TOOL_LIMITS.maxFiles,
  pdfSearchPages: TOOL_LIMITS['find-pdf'].maxPages,
};
