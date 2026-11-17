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

const { killProcessTree } = jest.requireActual<typeof import('@/lib/puppeteer/process-tree')>(
  '@/lib/puppeteer/process-tree',
);

function fakeChild(state: { running: boolean; pid?: number }): ChildProcess & { kill: jest.Mock } {
  return {
    pid: 'pid' in state ? state.pid : process.pid,
    exitCode: state.running ? null : 0,
    signalCode: null,
    kill: jest.fn(),
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

  it('ends the whole tree with taskkill on Windows, the pid passed as its own argument', async () => {
    const child = fakeChild({ running: true, pid: 4242 });
    const runTaskkill = jest.fn().mockResolvedValue(undefined);

    await killProcessTree(child, { platform: 'win32', runTaskkill });

    expect(runTaskkill).toHaveBeenCalledWith(4242);
    expect(child.kill).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('SIGKILLs only the main process elsewhere, which takes its children with it', async () => {
    const child = fakeChild({ running: true });
    const runTaskkill = jest.fn();

    await killProcessTree(child, { platform: 'linux', runTaskkill });

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(runTaskkill).not.toHaveBeenCalled();
  });

  it('is quiet when taskkill fails only because a child was already exiting', async () => {
    const child = fakeChild({ running: false });

    await killProcessTree(child, {
      platform: 'win32',
      runTaskkill: jest.fn().mockRejectedValue(new Error('could not be terminated')),
    });

    expect(child.kill).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to SIGKILL and warns once, without throwing, when the browser survives taskkill', async () => {
    const child = fakeChild({ running: true });

    await expect(
      killProcessTree(child, { platform: 'win32', runTaskkill: jest.fn().mockRejectedValue(new Error('timed out')) }),
    ).resolves.toBeUndefined();

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(warn).toHaveBeenCalledTimes(1);
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
    const child = fakeChild({ running: true });
    const closing = closeBrowser(fakeBrowser(() => new Promise(() => {}), child));

    await jest.advanceTimersByTimeAsync(5_000);
    await closing;

    expect(mockKillProcessTree).toHaveBeenCalledWith(child);
    expect(mockCalls).toEqual(['kill', 'release']);
  });

  it('kills nothing when the browser closes in time', async () => {
    await closeBrowser(fakeBrowser(async () => {}, fakeChild({ running: true })));

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
