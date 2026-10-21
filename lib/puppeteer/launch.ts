import puppeteer, { type Browser } from 'puppeteer';

// Containers often give /dev/shm only 64 MB, which Chromium outgrows on large pages.
const BASE_ARGS = ['--disable-dev-shm-usage'];
const NO_SANDBOX_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];

/**
 * The sandbox stays on unless CHROMIUM_DISABLE_SANDBOX is set to "true". It is what confines
 * a renderer that a hostile page has compromised, and HTML to PDF renders pages users choose,
 * so turning it off is an explicit deployment decision (see README), never a fallback.
 */
function isChromiumSandboxDisabled(): boolean {
  return process.env.CHROMIUM_DISABLE_SANDBOX?.trim().toLowerCase() === 'true';
}

export function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    // By default puppeteer kills its browsers as soon as Node gets one of these signals,
    // failing every render in progress. next start's own shutdown waits for requests to
    // finish, and each render closes its browser when it ends.
    handleSIGTERM: false,
    handleSIGINT: false,
    handleSIGHUP: false,
    args: isChromiumSandboxDisabled() ? [...BASE_ARGS, ...NO_SANDBOX_ARGS] : BASE_ARGS,
  });
}
