import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { startEgressProxy, type EgressProxy } from '@/lib/puppeteer/egress-proxy';

// Containers often give /dev/shm only 64 MB, which Chromium outgrows on large pages.
const BASE_ARGS = ['--disable-dev-shm-usage'];
const NO_SANDBOX_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];

/**
 * What a render may reach. Either way every connection Chromium makes goes through a local
 * egress proxy. `public`: the proxy connects to public addresses only (HTML to PDF, which
 * loads what users choose). `none`: the proxy refuses everything (DOCX to PDF), which also
 * covers the connections Chromium opens speculatively, before request interception applies.
 */
export type RendererNetwork = 'public' | 'none';

/**
 * WebRTC sends UDP (STUN, TURN, media) straight from the browser, around any HTTP proxy;
 * this policy allows it no UDP at all. Chromium takes it only from the profile's preferences:
 * the --force-webrtc-ip-handling-policy switch leaves UDP candidates in place.
 */
const PROFILE_PREFERENCES = { webrtc: { ip_handling_policy: 'disable_non_proxied_udp' } };

interface LaunchResources {
  proxy: EgressProxy;
  profileDir: string;
}

const launches = new WeakMap<Browser, LaunchResources>();

/**
 * The sandbox stays on unless CHROMIUM_DISABLE_SANDBOX is set to "true". It is what confines
 * a renderer that a hostile page has compromised, and HTML to PDF renders pages users choose,
 * so turning it off is an explicit deployment decision (see README), never a fallback.
 */
function isChromiumSandboxDisabled(): boolean {
  return process.env.CHROMIUM_DISABLE_SANDBOX?.trim().toLowerCase() === 'true';
}

function proxyArgs(proxy: EgressProxy): string[] {
  return [
    `--proxy-server=${proxy.url}`,
    // Without it Chromium sends localhost, 127.0.0.1 and [::1] direct, around the proxy.
    '--proxy-bypass-list=<-loopback>',
  ];
}

async function createProfile(): Promise<string> {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'vellum-render-profile-'));
  await mkdir(path.join(profileDir, 'Default'));
  await writeFile(path.join(profileDir, 'Default', 'Preferences'), JSON.stringify(PROFILE_PREFERENCES));
  return profileDir;
}

// Windows can hold a profile's files for a moment after Chromium exits, so removal retries.
async function removeProfile(profileDir: string): Promise<void> {
  try {
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`[render] could not remove the browser profile ${profileDir}:`, error);
  }
}

async function release({ proxy, profileDir }: LaunchResources): Promise<void> {
  await proxy.close();
  await removeProfile(profileDir);
}

export async function launchBrowser(network: RendererNetwork): Promise<Browser> {
  const resources: LaunchResources = {
    proxy: await startEgressProxy({ refuseAll: network === 'none' }),
    profileDir: await createProfile(),
  };
  const args = [...BASE_ARGS, ...(isChromiumSandboxDisabled() ? NO_SANDBOX_ARGS : []), ...proxyArgs(resources.proxy)];

  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      // By default puppeteer kills its browsers as soon as Node gets one of these signals,
      // failing every render in progress. next start's own shutdown waits for requests to
      // finish, and each render closes its browser when it ends.
      handleSIGTERM: false,
      handleSIGINT: false,
      handleSIGHUP: false,
      userDataDir: resources.profileDir,
      args,
    });
  } catch (error) {
    await release(resources);
    throw error;
  }

  launches.set(browser, resources);
  return browser;
}

/**
 * A new blank page that can use the browser's egress proxy. Chromium answers
 * the proxy's credential challenge only for top-level navigations, so the page loads the
 * proxy's own empty page once to cache the credential for its sub-resources, WebSockets
 * and WebRTC, then goes back to about:blank.
 */
export async function openRenderPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  const proxy = launches.get(browser)?.proxy;
  if (proxy) {
    await page.authenticate(proxy.credentials);
    await page.goto(proxy.primeUrl);
    await page.goto('about:blank');
  }
  return page;
}

/** Whether the browser's egress proxy refused a connection to the host and port of `url`. */
export function wasDestinationRefused(browser: Browser, url: string): boolean {
  const proxy = launches.get(browser)?.proxy;
  if (!proxy) return false;
  try {
    const { hostname, port, protocol } = new URL(url);
    const defaultPort = protocol === 'https:' ? 443 : 80;
    return proxy.wasRefused(hostname, Number(port || defaultPort));
  } catch {
    return false;
  }
}

/** Closes the browser's egress proxy and removes its profile. Called once the browser is gone. */
export async function releaseLaunchResources(browser: Browser): Promise<void> {
  const resources = launches.get(browser);
  launches.delete(browser);
  if (resources) await release(resources);
}
