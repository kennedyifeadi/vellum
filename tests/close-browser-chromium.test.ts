import { execFileSync } from 'child_process';
import type { Browser } from 'puppeteer';
import { launchBrowser } from '@/lib/puppeteer/launch';
import { closeBrowser } from '@/lib/puppeteer/lifecycle';
import { profileDirOf, stopProfileProcessesCommand } from '@/lib/puppeteer/process-tree';
import { launchTrackedBrowser, leftoverChromiumProcesses } from './helpers/heldRenders';

// Real Chromium: a close that times out must leave none of the browser's processes running.
// On Windows the crash-reporter children outlive a kill of the main process and exit only
// once they notice it is gone, which on a loaded machine can take over a minute. Suspending
// them stands in for that load: a suspended process can only be ended, never exit by itself.

function profileOf(browser: Browser): string {
  const profileDir = profileDirOf(browser.process()!);
  if (!profileDir) throw new Error('The launched browser has no profile');
  return profileDir;
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

function stopProcessesOf(profile: string): void {
  const { file, args, env } = stopProfileProcessesCommand(profile);
  execFileSync(file, args, { env, stdio: 'ignore' });
}

it('leaves no Chromium process of the profile running when the graceful close times out', async () => {
  const browser = await launchTrackedBrowser(() => launchBrowser('none'));
  const profile = profileOf(browser);
  browser.close = () => new Promise(() => {});

  const onWindows = process.platform === 'win32';
  try {
    if (onWindows) suspendCrashReporters(profile);
    await closeBrowser(browser);
    expect(await leftoverChromiumProcesses()).toEqual([]);
  } finally {
    if (onWindows) stopProcessesOf(profile);
  }
}, 120_000);
