import { pdfToolBusyMessage } from '@/lib/convert/pdf-worker-limits';

// How many Chromium renders may run at once, across HTML to PDF and DOCX to PDF. Each
// launches its own browser, so this bounds the browsers alive at once, and memory with it.
export const MAX_CONCURRENT_RENDERS = 2;

export const HTML_TO_PDF_BUSY_MESSAGE = pdfToolBusyMessage('HTML to PDF');
export const DOCX_TO_PDF_BUSY_MESSAGE = pdfToolBusyMessage('DOCX to PDF');

export class BrowserToolBusyError extends Error {
  constructor() {
    super('Too many browser renders are already running');
    this.name = 'BrowserToolBusyError';
  }
}

let activeRenders = 0;

/**
 * Runs one request's render, or refuses at once with `BrowserToolBusyError` when
 * `MAX_CONCURRENT_RENDERS` are already running. `work` closes its browser before it
 * settles, the render deadline and a crashed browser included, so the slot is held for
 * as long as that browser lives.
 */
export async function runRenderJob<Result>(work: () => Promise<Result>): Promise<Result> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    throw new BrowserToolBusyError();
  }

  activeRenders += 1;
  try {
    return await work();
  } finally {
    activeRenders -= 1;
  }
}
