import { execFileSync, type ChildProcess } from 'child_process';
import type { Browser, Page } from 'puppeteer';

// Wraps the real Chromium launcher so a test can count the browsers it started and hold
// each render at its setContent until the test lets it go, without sleeping.

export interface HeldRender {
  /** Lets the render go on to its real setContent and PDF. */
  finish(): void;
  /** Kills the render's browser process, then lets the render go on against it. */
  killBrowser(): void;
}

const started: HeldRender[] = [];
const unreleased = new Set<HeldRender>();
const liveBrowsers = new Set<ChildProcess>();
const userDataDirs = new Set<string>();
let peakBrowsers = 0;

function trackProcess(browser: Browser): void {
  const process = browser.process();
  if (!process) throw new Error('The launched browser has no process to count');

  const userDataDir = process.spawnargs.find((arg) => arg.startsWith('--user-data-dir='));
  if (userDataDir) userDataDirs.add(userDataDir.slice('--user-data-dir='.length));

  liveBrowsers.add(process);
  peakBrowsers = Math.max(peakBrowsers, liveBrowsers.size);
  process.once('exit', () => liveBrowsers.delete(process));
}

function holdSetContent(page: Page, browser: Browser): void {
  const setContent = page.setContent.bind(page);
  page.setContent = async (html, options) => {
    await new Promise<void>((resolve) => {
      const render: HeldRender = {
        finish() {
          unreleased.delete(render);
          resolve();
        },
        killBrowser() {
          browser.process()?.kill('SIGKILL');
          render.finish();
        },
      };
      started.push(render);
      unreleased.add(render);
    });
    return setContent(html, options);
  };
}

/** Launches a real browser with `launch`, counted and with its renders held. */
export async function launchHeldBrowser(launch: () => Promise<Browser>): Promise<Browser> {
  const browser = await launch();
  trackProcess(browser);

  const newPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await newPage();
    holdSetContent(page, browser);
    return page;
  };
  return browser;
}

/**
 * The next render to reach its setContent. Rejects if `stopWaiting` says so first, as
 * when the request has already been answered without rendering.
 */
export async function nextHeldRender(stopWaiting = () => false): Promise<HeldRender> {
  for (;;) {
    const render = started.shift();
    if (render) return render;
    if (stopWaiting()) throw new Error('No render started');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function liveBrowserCount(): number {
  return liveBrowsers.size;
}

export function peakBrowserCount(): number {
  return peakBrowsers;
}

/** Lets every render still held go on, so none is left waiting, and forgets the counts. */
export function resetHeldRenders(): void {
  for (const render of unreleased) render.finish();
  started.length = 0;
  peakBrowsers = liveBrowsers.size;
}

/** Waits for every browser the tests launched to have exited. */
export async function allBrowsersExited(): Promise<void> {
  while (liveBrowsers.size > 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Operating-system processes, a browser's children included, still running with the
 * profile directory of a browser these tests launched.
 */
export function leftoverChromiumProcesses(): string[] {
  if (userDataDirs.size === 0) return [];
  const commandLines =
    process.platform === 'win32'
      ? execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }'],
          { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
        )
      : execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return commandLines
    .split(/\r?\n/)
    .filter((line) => [...userDataDirs].some((dir) => line.includes(dir)));
}
