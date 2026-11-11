import http, { type IncomingHttpHeaders } from 'http';
import net, { type AddressInfo, type Socket } from 'net';
import { startEgressProxy, type EgressProxy, type EgressProxyOptions } from '@/lib/puppeteer/egress-proxy';

jest.setTimeout(30_000);

interface Received {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
}

let upstream: http.Server;
let upstreamPort: number;
let received: Received[];
let echo: net.Server;
let echoPort: number;
let echoSockets: Socket[];
let proxy: EgressProxy | undefined;

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

beforeEach(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  received = [];
  upstream = http.createServer((req, res) => {
    received.push({ method: req.method, url: req.url, headers: req.headers });
    res.end('from upstream');
  });
  upstreamPort = await listen(upstream);

  echoSockets = [];
  echo = net.createServer((socket) => {
    echoSockets.push(socket);
    socket.on('data', (chunk) => socket.write(`pong:${chunk.toString().replace(/^ping:/, '')}`));
    socket.on('error', () => socket.destroy());
  });
  echoPort = await listen(echo);
});

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  upstream.closeAllConnections();
  for (const socket of echoSockets) socket.destroy();
  await Promise.all([closeServer(upstream), closeServer(echo)]);
  (console.warn as jest.Mock).mockRestore();
});

/** A test resolver: `name` maps to `addresses`, anything else does not resolve. */
function resolverFor(map: Record<string, string[]>): EgressProxyOptions['resolve'] {
  return async (hostname) => {
    const addresses = map[hostname];
    if (!addresses) throw new Error(`ENOTFOUND ${hostname}`);
    return addresses;
  };
}

/** Lets the proxy reach only this test's servers, never anything outside the machine. */
function onlyUpstream(address: string, port: number): boolean {
  return address === '127.0.0.1' && (port === upstreamPort || port === echoPort);
}

function authorization(p: EgressProxy): string {
  return `Basic ${Buffer.from(`${p.credentials.username}:${p.credentials.password}`).toString('base64')}`;
}

function proxiedGet(
  p: EgressProxy,
  absoluteUrl: string,
  headers: Record<string, string> = { 'proxy-authorization': authorization(p) },
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const target = new URL(absoluteUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: p.port,
      path: absoluteUrl,
      headers: { host: target.host, ...headers },
      agent: false,
    });
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function connectThrough(
  p: EgressProxy,
  target: string,
  headers: Record<string, string> = { 'proxy-authorization': authorization(p) },
): Promise<{ status: number; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: p.port, method: 'CONNECT', path: target, headers, agent: false });
    req.on('connect', (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
    req.on('response', (res) => resolve({ status: res.statusCode ?? 0, socket: res.socket }));
    req.on('error', reject);
    req.end();
  });
}

function nextData(socket: Socket): Promise<string> {
  return new Promise((resolve) => socket.once('data', (chunk) => resolve(chunk.toString())));
}

function closed(socket: Socket): Promise<void> {
  return new Promise((resolve) => (socket.destroyed ? resolve() : socket.once('close', () => resolve())));
}

describe('egress proxy, absolute-URI HTTP requests', () => {
  it('connects to the address it validated, with the Host header and query untouched', async () => {
    proxy = await startEgressProxy({
      resolve: resolverFor({ 'allowed.test': ['127.0.0.1'] }),
      isDestinationAllowed: onlyUpstream,
    });

    const res = await proxiedGet(proxy, `http://allowed.test:${upstreamPort}/page?x=1`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('from upstream');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: 'GET', url: '/page?x=1' });
    expect(received[0].headers.host).toBe(`allowed.test:${upstreamPort}`);
    expect(received[0].headers['proxy-authorization']).toBeUndefined();
  });

  it('resolves each hostname once for the life of the proxy', async () => {
    const resolve = jest.fn(resolverFor({ 'allowed.test': ['127.0.0.1'] }));
    proxy = await startEgressProxy({ resolve, isDestinationAllowed: onlyUpstream });

    await proxiedGet(proxy, `http://allowed.test:${upstreamPort}/a`);
    await proxiedGet(proxy, `http://allowed.test:${upstreamPort}/b`);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(2);
  });

  it('refuses with 403 a hostname that resolves to a blocked address', async () => {
    proxy = await startEgressProxy({ resolve: resolverFor({ 'rebind.test': ['127.0.0.1'] }) });

    const res = await proxiedGet(proxy, `http://rebind.test:${upstreamPort}/secret?token=abc`);

    expect(res.status).toBe(403);
    expect(received).toEqual([]);
    expect(proxy.wasRefused('rebind.test', upstreamPort)).toBe(true);
  });

  it('refuses with 403 a hostname that resolves to a mix of public and blocked addresses', async () => {
    proxy = await startEgressProxy({ resolve: resolverFor({ 'mixed.test': ['93.184.216.34', '127.0.0.1'] }) });

    const res = await proxiedGet(proxy, `http://mixed.test:${upstreamPort}/`);

    expect(res.status).toBe(403);
    expect(received).toEqual([]);
  });

  it('refuses with 403 a hostname that does not resolve', async () => {
    proxy = await startEgressProxy({ resolve: resolverFor({}) });

    const res = await proxiedGet(proxy, `http://nowhere.test:${upstreamPort}/`);

    expect(res.status).toBe(403);
    expect(proxy.wasRefused('nowhere.test', upstreamPort)).toBe(true);
  });

  it('refuses a blocked IP literal without resolving it', async () => {
    const resolve = jest.fn(resolverFor({}));
    proxy = await startEgressProxy({ resolve });

    const res = await proxiedGet(proxy, `http://127.0.0.1:${upstreamPort}/`);

    expect(res.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  it('logs a refusal without the query string', async () => {
    proxy = await startEgressProxy({ resolve: resolverFor({ 'rebind.test': ['10.0.0.1'] }) });

    await proxiedGet(proxy, `http://rebind.test:${upstreamPort}/path?token=secret-value`);

    const logged = (console.warn as jest.Mock).mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain(`http://rebind.test:${upstreamPort}/path`);
    expect(logged).not.toContain('secret-value');
  });

  it('answers 407 without the credential, and with a wrong one', async () => {
    proxy = await startEgressProxy({
      resolve: resolverFor({ 'allowed.test': ['127.0.0.1'] }),
      isDestinationAllowed: onlyUpstream,
    });
    const url = `http://allowed.test:${upstreamPort}/`;

    const missing = await proxiedGet(proxy, url, {});
    const wrong = await proxiedGet(proxy, url, {
      'proxy-authorization': `Basic ${Buffer.from('render:guess').toString('base64')}`,
    });

    expect(missing.status).toBe(407);
    expect(missing.headers['proxy-authenticate']).toMatch(/^Basic /);
    expect(wrong.status).toBe(407);
    expect(received).toEqual([]);
  });

  it('gives every proxy its own credential', async () => {
    const first = await startEgressProxy();
    const second = await startEgressProxy();
    try {
      expect(first.credentials.password).not.toBe(second.credentials.password);
      expect(first.port).not.toBe(second.port);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe('egress proxy, CONNECT tunnels', () => {
  it('passes bytes both ways through a tunnel to the validated address', async () => {
    proxy = await startEgressProxy({
      resolve: resolverFor({ 'allowed.test': ['127.0.0.1'] }),
      isDestinationAllowed: onlyUpstream,
    });

    const { status, socket } = await connectThrough(proxy, `allowed.test:${echoPort}`);
    expect(status).toBe(200);

    const reply = nextData(socket);
    socket.write('ping:hello');
    expect(await reply).toBe('pong:hello');
    socket.destroy();
  });

  it('refuses with 403 a tunnel to a hostname that resolves to a blocked address', async () => {
    proxy = await startEgressProxy({ resolve: resolverFor({ 'rebind.test': ['127.0.0.1'] }) });

    const { status, socket } = await connectThrough(proxy, `rebind.test:${echoPort}`);

    expect(status).toBe(403);
    expect(echoSockets).toEqual([]);
    socket.destroy();
  });

  it('refuses with 403 a tunnel to a blocked IPv6 literal', async () => {
    proxy = await startEgressProxy();

    const { status, socket } = await connectThrough(proxy, `[::1]:${echoPort}`);

    expect(status).toBe(403);
    socket.destroy();
  });

  it('answers 407 to a tunnel without the credential', async () => {
    proxy = await startEgressProxy({
      resolve: resolverFor({ 'allowed.test': ['127.0.0.1'] }),
      isDestinationAllowed: onlyUpstream,
    });

    const { status, socket } = await connectThrough(proxy, `allowed.test:${echoPort}`, {});

    expect(status).toBe(407);
    expect(echoSockets).toEqual([]);
    socket.destroy();
  });

  it('closes the upstream connection when the client disconnects', async () => {
    proxy = await startEgressProxy({
      resolve: resolverFor({ 'allowed.test': ['127.0.0.1'] }),
      isDestinationAllowed: onlyUpstream,
    });
    const { socket } = await connectThrough(proxy, `allowed.test:${echoPort}`);
    const reply = nextData(socket);
    socket.write('ping:x');
    await reply;

    socket.destroy();

    expect(echoSockets).toHaveLength(1);
    await closed(echoSockets[0]);
  });
});

describe('egress proxy, closing', () => {
  it('leaves no listening port and ends open tunnels', async () => {
    const p = await startEgressProxy({
      resolve: resolverFor({ 'allowed.test': ['127.0.0.1'] }),
      isDestinationAllowed: onlyUpstream,
    });
    const { socket } = await connectThrough(p, `allowed.test:${echoPort}`);

    await p.close();

    await closed(socket);
    const refused = await new Promise<string | undefined>((resolve) => {
      const probe = net.connect({ host: '127.0.0.1', port: p.port });
      probe.once('connect', () => {
        probe.destroy();
        resolve(undefined);
      });
      probe.once('error', (error: NodeJS.ErrnoException) => resolve(error.code));
    });
    expect(refused).toBe('ECONNREFUSED');
  });

  it('can be closed twice', async () => {
    const p = await startEgressProxy();
    await p.close();
    await expect(p.close()).resolves.toBeUndefined();
  });
});
