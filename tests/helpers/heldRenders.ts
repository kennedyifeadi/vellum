import { execFileSync, type ChildProcess } from 'child_process';
import fs from 'fs';
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
  peakBrowsers = Math.max(peakBrowsers, countLiveBrowsers());
}

// On a loaded Windows machine Node sometimes never emits 'exit' for a browser the OS has
// already ended, so whether a browser still runs is asked of the OS instead.
function isRunning(child: ChildProcess): boolean {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function countLiveBrowsers(): number {
  for (const child of liveBrowsers) {
    if (!isRunning(child)) liveBrowsers.delete(child);
  }
  return liveBrowsers.size;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
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
          killProcessTree(browser.process());
          render.finish();
        },
      };
      started.push(render);
      unreleased.add(render);
    });
    return setContent(html, options);
  };
}

// Killing only the main process on Windows leaves its GPU and crash-reporter children
// running, where Linux takes them down with it, so a crash there is the whole tree.
function killProcessTree(child: ChildProcess | null): void {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
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
  return countLiveBrowsers();
}

export function peakBrowserCount(): number {
  return peakBrowsers;
}

/** Lets every render still held go on, so none is left waiting, and forgets the counts. */
export function resetHeldRenders(): void {
  for (const render of unreleased) render.finish();
  started.length = 0;
  peakBrowsers = countLiveBrowsers();
}

/** Waits for every browser the tests launched to have exited. */
export async function allBrowsersExited(): Promise<void> {
  while (countLiveBrowsers() > 0) {
    await nextTurn();
  }
}

/**
 * Operating-system processes, a browser's children included, still running with the
 * profile directory of a browser these tests launched, once they have had `graceMs` to go.
 * A killed browser's GPU and crash-reporter children notice and exit a moment after it.
 */
export async function leftoverChromiumProcesses(graceMs = 60_000): Promise<string[]> {
  const giveUpAt = Date.now() + graceMs;
  for (;;) {
    const leftovers = chromiumProcessesOfTheseTests();
    if (leftovers.length === 0 || Date.now() > giveUpAt) return leftovers;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function chromiumProcessesOfTheseTests(): string[] {
  if (userDataDirs.size === 0) return [];
  return runningCommandLines().filter((line) => [...userDataDirs].some((dir) => line.includes(dir)));
}

// The container's slim Debian has no ps, so Linux reads /proc directly.
function runningCommandLines(): string[] {
  if (process.platform === 'win32') {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ).split(/\r?\n/);
  }
  if (process.platform === 'linux') {
    return fs
      .readdirSync('/proc')
      .filter((entry) => /^\d+$/.test(entry))
      .map((pid) => {
        try {
          return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
        } catch {
          return '';
        }
      });
  }
  return execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
}
