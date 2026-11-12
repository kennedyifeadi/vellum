const mockPage = {
  authenticate: jest.fn().mockResolvedValue(undefined),
  goto: jest.fn().mockResolvedValue(null),
};
const mockBrowser = {
  close: jest.fn().mockResolvedValue(undefined),
  process: () => null,
  newPage: jest.fn().mockResolvedValue(mockPage),
};

jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue(mockBrowser),
}));

import fs from 'fs';
import net from 'net';
import path from 'path';
import puppeteer from 'puppeteer';
import { launchBrowser, openRenderPage, type RendererNetwork } from '@/lib/puppeteer/launch';
import { closeBrowser } from '@/lib/puppeteer/lifecycle';
import { convertHtmlToPdf } from '@/lib/html/to-pdf';
import { convertDocxToPdf } from '@/lib/doc/to-pdf';

const launch = puppeteer.launch as jest.Mock;

function launchArgs(): string[] {
  return launch.mock.calls[launch.mock.calls.length - 1][0].args;
}

function proxyPort(): number {
  const proxyServer = launchArgs().find((arg) => arg.startsWith('--proxy-server='));
  if (!proxyServer) throw new Error('Chromium was launched without a proxy');
  return Number(new URL(proxyServer.slice('--proxy-server='.length)).port);
}

function profileDir(): string {
  return launch.mock.calls[launch.mock.calls.length - 1][0].userDataDir;
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect({ host: '127.0.0.1', port });
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}

describe('launchBrowser', () => {
  // CI sets it for the whole suite, since its container runs the tests as root.
  beforeEach(() => {
    delete process.env.CHROMIUM_DISABLE_SANDBOX;
  });

  afterEach(() => {
    delete process.env.CHROMIUM_DISABLE_SANDBOX;
    launch.mockClear();
  });

  /** Launches and closes a browser, and returns the arguments Chromium was given. */
  async function argsOfLaunch(network: RendererNetwork): Promise<string[]> {
    await closeBrowser(await launchBrowser(network));
    return launchArgs();
  }

  it('keeps the Chromium sandbox on by default', async () => {
    const args = await argsOfLaunch('none');
    expect(args).not.toContain('--no-sandbox');
    expect(args).not.toContain('--disable-setuid-sandbox');
  });

  it.each(['false', '1', 'yes', ''])('keeps the sandbox on when CHROMIUM_DISABLE_SANDBOX=%p', async (value) => {
    process.env.CHROMIUM_DISABLE_SANDBOX = value;
    expect(await argsOfLaunch('none')).not.toContain('--no-sandbox');
  });

  it('turns the sandbox off only when CHROMIUM_DISABLE_SANDBOX is "true"', async () => {
    process.env.CHROMIUM_DISABLE_SANDBOX = 'true';
    expect(await argsOfLaunch('none')).toEqual(expect.arrayContaining(['--no-sandbox', '--disable-setuid-sandbox']));
  });

  it('leaves shutdown signals to the server, so renders in progress can finish', async () => {
    await argsOfLaunch('none');
    expect(launch.mock.calls[0][0]).toMatchObject({
      handleSIGTERM: false,
      handleSIGINT: false,
      handleSIGHUP: false,
    });
  });

  describe.each(['public', 'none'] as const)('a browser with %s network access', (network) => {
    it('sends every connection through its own local egress proxy', async () => {
      const browser = await launchBrowser(network);
      try {
        expect(launchArgs()).toEqual(
          expect.arrayContaining([
            `--proxy-server=http://127.0.0.1:${proxyPort()}`,
            '--proxy-bypass-list=<-loopback>',
          ]),
        );
        expect(await isListening(proxyPort())).toBe(true);
      } finally {
        await closeBrowser(browser);
      }
    });

    it('authenticates each page to the proxy and primes the credential, leaving the page blank', async () => {
      mockPage.authenticate.mockClear();
      mockPage.goto.mockClear();
      const browser = await launchBrowser(network);
      try {
        await openRenderPage(browser);
        expect(mockPage.authenticate).toHaveBeenCalledWith({
          username: expect.any(String),
          password: expect.stringMatching(/.{16,}/),
        });
        expect(mockPage.goto.mock.calls.map(([url]) => url)).toEqual(['http://egress-proxy.invalid/', 'about:blank']);
      } finally {
        await closeBrowser(browser);
      }
    });

    it('gives it its own profile, whose preferences allow WebRTC no UDP', async () => {
      const browser = await launchBrowser(network);
      try {
        const preferences = JSON.parse(fs.readFileSync(path.join(profileDir(), 'Default', 'Preferences'), 'utf8'));
        expect(preferences.webrtc.ip_handling_policy).toBe('disable_non_proxied_udp');
      } finally {
        await closeBrowser(browser);
      }
    });

    it('closes the proxy and removes the profile with the browser', async () => {
      const browser = await launchBrowser(network);
      const port = proxyPort();
      const profile = profileDir();

      await closeBrowser(browser);

      expect(await isListening(port)).toBe(false);
      expect(fs.existsSync(profile)).toBe(false);
    });

    it('closes the proxy and removes the profile when Chromium fails to launch', async () => {
      launch.mockRejectedValueOnce(new Error('no chromium'));

      await expect(launchBrowser(network)).rejects.toThrow('no chromium');

      expect(await isListening(proxyPort())).toBe(false);
      expect(fs.existsSync(profileDir())).toBe(false);
    });
  });

  it('gives each browser its own proxy and profile', async () => {
    await argsOfLaunch('public');
    const [firstPort, firstProfile] = [proxyPort(), profileDir()];
    await argsOfLaunch('public');
    expect(proxyPort()).not.toBe(firstPort);
    expect(profileDir()).not.toBe(firstProfile);
  });

  async function docxBuffer(): Promise<Buffer> {
    const docx = await import('docx');
    return docx.Packer.toBuffer(new docx.Document({ sections: [{ children: [new docx.Paragraph('x')] }] }));
  }

  const renderers: [string, () => Promise<Buffer>][] = [
    ['HTML to PDF', () => convertHtmlToPdf({ htmlContent: '<p>x</p>' })],
    ['DOCX to PDF', async () => convertDocxToPdf({ docxBuffer: await docxBuffer() })],
  ];

  describe.each(renderers)('%s', (_name, render) => {
    beforeEach(() => {
      launch.mockResolvedValue({
        ...mockBrowser,
        newPage: jest.fn().mockRejectedValue(new Error('stop after launch')),
      });
    });

    it('launches Chromium behind an egress proxy and closes it when the render fails', async () => {
      await expect(render()).rejects.toThrow('stop after launch');
      expect(await isListening(proxyPort())).toBe(false);
    });

    it('launches Chromium sandboxed by default', async () => {
      await expect(render()).rejects.toThrow('stop after launch');
      expect(launchArgs()).not.toContain('--no-sandbox');
    });

    it('honours CHROMIUM_DISABLE_SANDBOX', async () => {
      process.env.CHROMIUM_DISABLE_SANDBOX = 'true';
      await expect(render()).rejects.toThrow('stop after launch');
      expect(launchArgs()).toContain('--no-sandbox');
    });
  });
});
