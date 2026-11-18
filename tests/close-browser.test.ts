import type { ChildProcess } from 'child_process';
import type { Browser } from 'puppeteer';

const mockCalls: string[] = [];
const mockKillProcessTree = jest.fn<Promise<void>, [ChildProcess]>(async () => {
  mockCalls.push('kill');
});

jest.mock('@/lib/puppeteer/process-tree', () => ({
  ...jest.requireActual('@/lib/puppeteer/process-tree'),
  killProcessTree: (child: ChildProcess) => mockKillProcessTree(child),
}));

jest.mock('@/lib/puppeteer/launch', () => ({
  releaseLaunchResources: jest.fn(async () => {
    mockCalls.push('release');
  }),
}));

import { closeBrowser } from '@/lib/puppeteer/lifecycle';

const { killProcessTree, stopProfileProcessesCommand } = jest.requireActual<typeof import('@/lib/puppeteer/process-tree')>(
  '@/lib/puppeteer/process-tree',
);

const PROFILE = 'C:\\Temp\\vellum-render-profile-abc123';

function fakeChild(calls: string[] = []): ChildProcess & { kill: jest.Mock } {
  return {
    pid: process.pid,
    exitCode: null,
    signalCode: null,
    spawnargs: ['chrome.exe', '--headless=new', `--user-data-dir=${PROFILE}`],
    kill: jest.fn((signal: string) => calls.push(`kill ${signal}`)),
  } as unknown as ChildProcess & { kill: jest.Mock };
}

describe('killProcessTree', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("on Windows kills the main process first, then the rest of its profile's processes", async () => {
    const calls: string[] = [];
    const child = fakeChild(calls);
    const stopProcessesOf = jest.fn(async (profileDir: string) => {
      calls.push(`stop ${profileDir}`);
    });

    await killProcessTree(child, { platform: 'win32', stopProcessesOf });

    expect(calls).toEqual(['kill SIGKILL', `stop ${PROFILE}`]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('SIGKILLs only the main process elsewhere, which takes its children with it', async () => {
    const child = fakeChild();
    const stopProcessesOf = jest.fn();

    await killProcessTree(child, { platform: 'linux', stopProcessesOf });

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(stopProcessesOf).not.toHaveBeenCalled();
  });

  it("warns once, without throwing, when the profile's processes cannot be ended", async () => {
    const child = fakeChild();

    await expect(
      killProcessTree(child, { platform: 'win32', stopProcessesOf: jest.fn().mockRejectedValue(new Error('timed out')) }),
    ).resolves.toBeUndefined();

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('stopProfileProcessesCommand', () => {
  it('runs PowerShell without a shell and passes the profile through the environment, not the script', () => {
    const profile = "C:\\Temp\\it's'; Remove-Item -Recurse C:\\";
    const { file, args, env } = stopProfileProcessesCommand(profile);

    expect(file).toBe('powershell.exe');
    expect(args.join(' ')).not.toContain(profile);
    expect(env.VELLUM_RENDER_PROFILE).toBe(profile);
  });
});

describe('closeBrowser', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCalls.length = 0;
    mockKillProcessTree.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function fakeBrowser(close: () => Promise<void>, child: ChildProcess | null): Browser {
    return { close, process: () => child } as unknown as Browser;
  }

  it('kills the process tree when the graceful close times out, then releases the proxy and profile', async () => {
    const child = fakeChild();
    const closing = closeBrowser(fakeBrowser(() => new Promise(() => {}), child));

    await jest.advanceTimersByTimeAsync(5_000);
    await closing;

    expect(mockKillProcessTree).toHaveBeenCalledWith(child);
    expect(mockCalls).toEqual(['kill', 'release']);
  });

  it('kills nothing when the browser closes in time', async () => {
    await closeBrowser(fakeBrowser(async () => {}, fakeChild()));

    expect(mockKillProcessTree).not.toHaveBeenCalled();
    expect(mockCalls).toEqual(['release']);
  });

  it('still releases, without throwing, when the timed-out browser has no process', async () => {
    const closing = closeBrowser(fakeBrowser(() => new Promise(() => {}), null));

    await jest.advanceTimersByTimeAsync(5_000);

    await expect(closing).resolves.toBeUndefined();
    expect(mockKillProcessTree).not.toHaveBeenCalled();
    expect(mockCalls).toEqual(['release']);
  });
});
