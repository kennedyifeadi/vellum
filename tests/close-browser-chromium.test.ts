import { execFileSync } from 'child_process';
import type { Browser } from 'puppeteer';
import { launchBrowser } from '@/lib/puppeteer/launch';
import { closeBrowser } from '@/lib/puppeteer/lifecycle';
import { launchTrackedBrowser, leftoverChromiumProcesses } from './helpers/heldRenders';

// Real Chromium: a close that times out must leave none of the browser's processes running.
// On Windows the crash-reporter children outlive a kill of the main process and exit only
// once they notice it is gone, which on a loaded machine can take over a minute. Suspending
// them stands in for that load: a suspended process can only be ended, never exit by itself.
//
// While a suspended crash reporter is being ended, the main process it reports for can stay
// listed for over a minute under load, already ended but not yet gone. So on Windows a
// process counts as left behind only while the OS still reports no exit code for it.

const GRACE_MS = 60_000;

function profileOf(browser: Browser): string {
  const arg = browser.process()?.spawnargs.find((a) => a.startsWith('--user-data-dir='));
  if (!arg) throw new Error('The launched browser has no profile');
  return arg.slice('--user-data-dir='.length);
}

function powershell(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
}

function processesOfProfile(profile: string): string {
  const escaped = profile.replaceAll("'", "''");
  return `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') }`;
}

function suspendCrashReporters(profile: string): void {
  const suspended = powershell(`
    Add-Type -TypeDefinition @'
    using System; using System.Runtime.InteropServices;
    public static class ProcessSuspend {
      [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
      [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
      [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    }
'@
    ${processesOfProfile(profile)} | Where-Object { $_.CommandLine.Contains('--type=crashpad-handler') } | ForEach-Object {
      $handle = [ProcessSuspend]::OpenProcess(0x0800, $false, $_.ProcessId)
      if ([ProcessSuspend]::NtSuspendProcess($handle) -eq 0) { $_.ProcessId }
      [void][ProcessSuspend]::CloseHandle($handle)
    }`);
  if (!suspended.trim()) throw new Error('No crash reporter of the browser was suspended');
}

// Node's signal 0 asks Windows for the exit code, so an ended process reads as gone.
function hasNoExitCode(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function runningProcessesOf(profile: string): Promise<string[]> {
  const giveUpAt = Date.now() + GRACE_MS;
  for (;;) {
    const running = powershell(`${processesOfProfile(profile)} | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`)
      .split(/\r?\n/)
      .filter((line) => line && hasNoExitCode(Number(line.split(' ')[0])));
    if (running.length === 0 || Date.now() > giveUpAt) return running;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function stopProcessesOf(profile: string): void {
  powershell(`${processesOfProfile(profile)} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}

it('leaves no Chromium process of the profile running when the graceful close times out', async () => {
  const browser = await launchTrackedBrowser(() => launchBrowser('none'));
  const profile = profileOf(browser);
  browser.close = () => new Promise(() => {});

  if (process.platform !== 'win32') {
    await closeBrowser(browser);
    expect(await leftoverChromiumProcesses(GRACE_MS)).toEqual([]);
    return;
  }

  try {
    suspendCrashReporters(profile);
    await closeBrowser(browser);
    expect(await runningProcessesOf(profile)).toEqual([]);
  } finally {
    stopProcessesOf(profile);
  }
}, 120_000);
