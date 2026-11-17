import { execFile, type ChildProcess } from 'child_process';

// taskkill took 2.3s at the median and 5.2s at p95 under six busy loops on an 8-core machine.
const TASKKILL_TIMEOUT_MS = 15_000;

export type TaskKill = (pid: number) => Promise<void>;

// Settles at the deadline even if the killed taskkill is slow to exit, as it was once under load.
function taskkill(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      runner.kill();
      reject(new Error(`taskkill did not finish within ${TASKKILL_TIMEOUT_MS} ms`));
    }, TASKKILL_TIMEOUT_MS);
    const runner = execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Whether the OS still runs `child`. On a loaded Windows machine Node sometimes never emits
 * 'exit' for a process the OS has already ended, so this asks the OS.
 */
export function isProcessRunning(child: ChildProcess): boolean {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return false;
  try {
    process.kill(child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Force-kills a browser and its child processes. Never throws.
 *
 * On Linux SIGKILL on the main process takes its children down with it. On Windows the GPU and
 * crash-reporter children keep running and hold the profile, so the whole tree is ended with
 * taskkill. taskkill exits non-zero when a child is already exiting (a renderer being replaced)
 * even though the tree is gone, so it is a failure only if the browser itself still runs.
 */
export async function killProcessTree(
  child: ChildProcess,
  { platform = process.platform, runTaskkill = taskkill }: { platform?: NodeJS.Platform; runTaskkill?: TaskKill } = {},
): Promise<void> {
  if (platform !== 'win32' || child.pid === undefined) {
    child.kill('SIGKILL');
    return;
  }
  try {
    await runTaskkill(child.pid);
  } catch (error) {
    if (!isProcessRunning(child)) return;
    child.kill('SIGKILL');
    console.warn(`[render] could not end the browser's process tree (pid ${child.pid}):`, error);
  }
}
