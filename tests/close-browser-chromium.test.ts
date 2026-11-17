import { execFileSync } from 'child_process';
import type { Browser } from 'puppeteer';
import { launchBrowser } from '@/lib/puppeteer/launch';
import { closeBrowser } from '@/lib/puppeteer/lifecycle';
import { launchTrackedBrowser, leftoverChromiumProcesses } from './helpers/heldRenders';

// Real Chromium: a close that times out must leave none of the browser's processes behind.
// On Windows the crash-reporter children outlive a kill of the main process and exit only
// once they notice it is gone, which on a loaded machine can take over a minute. Suspending
// them stands in for that load: a suspended child can only be ended, never exit by itself.

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

function suspendChildren(browser: Browser): void {
  const mainPid = browser.process()?.pid;
  const suspended = powershell(`
    Add-Type -TypeDefinition @'
    using System; using System.Runtime.InteropServices;
    public static class ProcessSuspend {
      [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
      [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
      [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    }
'@
    ${processesOfProfile(profileOf(browser))} | Where-Object { $_.ProcessId -ne ${mainPid} } | ForEach-Object {
      $handle = [ProcessSuspend]::OpenProcess(0x0800, $false, $_.ProcessId)
      if ([ProcessSuspend]::NtSuspendProcess($handle) -eq 0) { $_.ProcessId }
      [void][ProcessSuspend]::CloseHandle($handle)
    }`);
  if (!suspended.trim()) throw new Error('No child process of the browser was suspended');
}

function stopProcessesOf(profile: string): void {
  powershell(`${processesOfProfile(profile)} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}

it('leaves no Chromium process of the profile behind when the graceful close times out', async () => {
  const browser = await launchTrackedBrowser(() => launchBrowser('none'));
  const profile = profileOf(browser);
  try {
    if (process.platform === 'win32') suspendChildren(browser);
    browser.close = () => new Promise(() => {});

    await closeBrowser(browser);

    expect(await leftoverChromiumProcesses(15_000)).toEqual([]);
  } finally {
    if (process.platform === 'win32') stopProcessesOf(profile);
  }
}, 90_000);
