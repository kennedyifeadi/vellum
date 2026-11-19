import { execFile, type ChildProcess } from 'child_process';

// The query took 0.7s idle and up to 2.2s under six busy loops on an 8-core machine.
const STOP_PROFILE_PROCESSES_TIMEOUT_MS = 15_000;

const STOP_PROFILE_PROCESSES_SCRIPT =
  "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | " +
  'Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:VELLUM_RENDER_PROFILE) } | ' +
  'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';

export interface Command {
  file: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Ends every Chromium process started with the profile `profileDir`. Each launch has its own
 * profile, so this reaches exactly one browser's processes. The path goes in through the
 * environment, never into the script.
 */
export function stopProfileProcessesCommand(profileDir: string): Command {
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', STOP_PROFILE_PROCESSES_SCRIPT],
    env: { ...process.env, VELLUM_RENDER_PROFILE: profileDir },
  };
}

export type StopProfileProcesses = (profileDir: string) => Promise<void>;

// Settles at the deadline even if the killed runner is slow to exit, as one was under load.
function stopProfileProcesses(profileDir: string): Promise<void> {
  const { file, args, env } = stopProfileProcessesCommand(profileDir);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      runner.kill();
      reject(new Error(`did not finish within ${STOP_PROFILE_PROCESSES_TIMEOUT_MS} ms`));
    }, STOP_PROFILE_PROCESSES_TIMEOUT_MS);
    const runner = execFile(file, args, { env, windowsHide: true }, (error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

export function profileDirOf(child: ChildProcess): string | undefined {
  const arg = child.spawnargs.find((a) => a.startsWith('--user-data-dir='));
  return arg?.slice('--user-data-dir='.length);
}

/**
 * Whether the OS still runs `child`. On a loaded Windows machine Node sometimes never emits
 * 'exit' for a process the OS has already ended, so this asks the OS.
 */
export function isProcessRunning(child: ChildProcess): boolean {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return false;
  return isPidRunning(child.pid);
}

/**
 * Whether the OS still runs the process `pid`. On Windows this reads its exit code, so a killed
 * process that the OS still lists while it finishes terminating reads as not running.
 */
export function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Force-kills a browser and its child processes. Never throws.
 *
 * On Linux SIGKILL on the main process takes its children down with it. On Windows the GPU and
 * crash-reporter children keep running and hold the profile, so they are ended too. The main
 * process goes first: while it runs, it starts a new GPU process for one that was killed, which
 * is how ending the tree children-first (taskkill /T) still left GPU processes behind.
 */
export async function killProcessTree(
  child: ChildProcess,
  {
    platform = process.platform,
    stopProcessesOf = stopProfileProcesses,
  }: { platform?: NodeJS.Platform; stopProcessesOf?: StopProfileProcesses } = {},
): Promise<void> {
  child.kill('SIGKILL');
  if (platform !== 'win32') return;
  try {
    const profileDir = profileDirOf(child);
    if (!profileDir) throw new Error('the browser was started without a profile');
    await stopProcessesOf(profileDir);
  } catch (error) {
    console.warn(`[render] could not end the child processes of browser ${child.pid}:`, error);
  }
}
