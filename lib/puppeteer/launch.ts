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

const proxies = new WeakMap<Browser, EgressProxy>();

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
    // WebRTC would otherwise send UDP (STUN, media) straight from the browser.
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  ];
}

export async function launchBrowser(network: RendererNetwork): Promise<Browser> {
  const proxy = await startEgressProxy({ refuseAll: network === 'none' });
  const args = [...BASE_ARGS, ...(isChromiumSandboxDisabled() ? NO_SANDBOX_ARGS : []), ...proxyArgs(proxy)];

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
      args,
    });
  } catch (error) {
    await proxy.close();
    throw error;
  }

  proxies.set(browser, proxy);
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
  const proxy = proxies.get(browser);
  if (proxy) {
    await page.authenticate(proxy.credentials);
    await page.goto(proxy.primeUrl);
    await page.goto('about:blank');
  }
  return page;
}

/** Whether the browser's egress proxy refused a connection to the host and port of `url`. */
export function wasDestinationRefused(browser: Browser, url: string): boolean {
  const proxy = proxies.get(browser);
  if (!proxy) return false;
  try {
    const { hostname, port, protocol } = new URL(url);
    const defaultPort = protocol === 'https:' ? 443 : 80;
    return proxy.wasRefused(hostname, Number(port || defaultPort));
  } catch {
    return false;
  }
}

/** Closes the browser's egress proxy, if it has one. */
export async function closeEgressProxy(browser: Browser): Promise<void> {
  const proxy = proxies.get(browser);
  proxies.delete(browser);
  await proxy?.close();
}
