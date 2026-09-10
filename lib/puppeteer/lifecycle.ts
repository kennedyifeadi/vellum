import type { Browser } from 'puppeteer';
import { ClientError } from '@/lib/convert/errors';

/**
 * How long a single HTML/DOCX render (navigation + layout + PDF) is allowed to take
 * before it is force-terminated. A pathological input (busy-loop script, multi-million
 * node DOM) blocks the renderer thread so puppeteer's own timeouts never fire cleanly;
 * this is the outer bound that always does.
 */
export const RENDER_TIMEOUT_MS = 30_000;

/** Grace period for a well-behaved `browser.close()` before the process is killed. */
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

export class RenderTimeoutError extends ClientError {
  constructor() {
    super('The document took too long to render and was stopped.', 400);
    this.name = 'RenderTimeoutError';
  }
}

/**
 * Closes a puppeteer browser, guaranteeing the OS process is gone even when a graceful
 * close hangs (which it does when the renderer is stuck). Never throws.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  let killTimer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      browser.close(),
      new Promise<never>((_, reject) => {
        killTimer = setTimeout(
          () => reject(new Error('browser.close() timed out')),
          BROWSER_CLOSE_TIMEOUT_MS,
        );
      }),
    ]);
  } catch {
    browser.process()?.kill('SIGKILL');
  } finally {
    if (killTimer) clearTimeout(killTimer);
  }
}

/**
 * Runs `render` under a hard deadline. If the deadline wins, the returned promise
 * rejects with {@link RenderTimeoutError}; the caller is responsible for tearing the
 * browser down (see {@link closeBrowser}). A late rejection from `render` after the
 * deadline is swallowed so it cannot surface as an unhandled rejection.
 */
export async function withRenderDeadline<T>(
  render: Promise<T>,
  timeoutMs: number = RENDER_TIMEOUT_MS,
): Promise<T> {
  render.catch(() => {});
  let deadlineTimer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      render,
      new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(() => reject(new RenderTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
