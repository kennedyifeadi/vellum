const mockLookup = jest.fn();
jest.mock('dns/promises', () => ({ lookup: (...args: any[]) => mockLookup(...args) }));

import { assertNavigableUrl, isRequestAllowed, isBlockedAddress } from '../lib/html/url-policy';
import { ClientError } from '../lib/convert/errors';

beforeEach(() => {
  jest.clearAllMocks();
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('assertNavigableUrl scheme allow-list', () => {
  it.each([
    'file:///etc/passwd',
    'file:///C:/Windows/win.ini',
    'data:text/html,<h1>x</h1>',
    'blob:https://example.com/1234',
    'ftp://example.com/secret',
    'chrome://version',
    'view-source:https://example.com',
    'gopher://example.com',
  ])('rejects %s before any lookup', async (url) => {
    await expect(assertNavigableUrl(url)).rejects.toBeInstanceOf(ClientError);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('rejects with a 400 status and an http/https-oriented message', async () => {
    const err = await assertNavigableUrl('file:///etc/passwd').catch((e) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/http/i);
  });

  it('allows a well-formed public https URL', async () => {
    await expect(assertNavigableUrl('https://example.com/report')).resolves.toBeUndefined();
  });
});

describe('assertNavigableUrl host / IP deny-list', () => {
  it.each([
    'http://localhost/admin',
    'http://LOCALHOST:3000/api/auth/me',
    'http://service.internal/',
    'http://cluster.local/',
  ])('rejects internal hostname %s without a lookup', async (url) => {
    await expect(assertNavigableUrl(url)).rejects.toBeInstanceOf(ClientError);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1/api/auth/me',
    'http://127.0.0.1:54321/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://172.16.9.9/',
    'http://192.168.1.1/',
    'http://0.0.0.0/',
  ])('rejects IP-literal %s', async (url) => {
    await expect(assertNavigableUrl(url)).rejects.toBeInstanceOf(ClientError);
  });

  it('rejects a public hostname that resolves to a loopback address (DNS rebinding)', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(assertNavigableUrl('https://rebind.example.com/')).rejects.toBeInstanceOf(ClientError);
  });

  it('rejects when any resolved address is private even if another is public', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ]);
    await expect(assertNavigableUrl('https://mixed.example.com/')).rejects.toBeInstanceOf(ClientError);
  });

  it('rejects when the hostname does not resolve', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertNavigableUrl('https://nope.invalid/')).rejects.toBeInstanceOf(ClientError);
  });

  it('allows a hostname that resolves only to public addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
    await expect(assertNavigableUrl('https://public.example.com/')).resolves.toBeUndefined();
  });
});

describe('isRequestAllowed (sub-resource interception)', () => {
  it('permits inert schemes that carry no egress', async () => {
    expect(await isRequestAllowed('about:blank')).toBe(true);
    expect(await isRequestAllowed('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('blocks file:// and internal targets', async () => {
    expect(await isRequestAllowed('file:///etc/passwd')).toBe(false);
    expect(await isRequestAllowed('http://127.0.0.1:9000/')).toBe(false);
    expect(await isRequestAllowed('http://169.254.169.254/')).toBe(false);
  });

  it('allows an ordinary public sub-resource', async () => {
    mockLookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
    expect(await isRequestAllowed('https://cdn.example.com/logo.png')).toBe(true);
  });
});

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '198.18.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '11.0.0.1',
    '172.15.0.1',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])('allows %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it('fails closed on an unparseable address', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});
