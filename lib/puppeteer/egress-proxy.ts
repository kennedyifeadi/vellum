import { randomBytes, timingSafeEqual } from 'crypto';
import { lookup } from 'dns/promises';
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'http';
import net, { type AddressInfo, type Socket } from 'net';
import { isBlockedAddress } from '@/lib/html/url-policy';

export type HostResolver = (hostname: string) => Promise<string[]>;

export interface EgressProxyOptions {
  /** Resolves a destination hostname to every address it has. Defaults to the system resolver. */
  resolve?: HostResolver;
  /** Whether the proxy may connect to `address:port`. Defaults to any public address. */
  isDestinationAllowed?: (address: string, port: number) => boolean;
  /** Refuse every destination, without looking anything up, whatever the options above say. */
  refuseAll?: boolean;
}

export interface ProxyCredentials {
  username: string;
  password: string;
}

export interface EgressProxy {
  /** The `--proxy-server` value for Chromium. */
  readonly url: string;
  /**
   * A URL the proxy answers itself, with an empty page, once the credential is presented.
   * Loading it first makes Chromium cache the credential and send it with every later
   * request, which it otherwise does only for top-level navigations.
   */
  readonly primeUrl: string;
  readonly port: number;
  readonly credentials: ProxyCredentials;
  /** Whether the proxy refused a connection to `hostname:port` during its lifetime. */
  wasRefused(hostname: string, port: number): boolean;
  /** Stops listening and destroys every client and upstream connection. */
  close(): Promise<void>;
}

const PROXY_REALM = 'vellum-render';
// .invalid never resolves (RFC 2606), so this cannot name a real destination.
const PRIME_HOST = 'egress-proxy.invalid';

// Hop-by-hop headers (RFC 9110 §7.6.1) and the proxy's own, never sent on to the destination
// or back to Chromium.
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

async function resolveWithSystem(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function isPublicAddress(address: string): boolean {
  return !isBlockedAddress(address);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function destinationKey(hostname: string, port: number): string {
  return `${normalizeHostname(hostname)}:${port}`;
}

function parseConnectTarget(target: string): { hostname: string; port: number } | null {
  const match = target.match(/^(\[[^\]]+\]|[^:]+):(\d{1,5})$/);
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  return { hostname: normalizeHostname(match[1]), port };
}

function forwardableHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const connectionTokens = String(headers.connection ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase());
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !HOP_BY_HOP_HEADERS.has(name) && !connectionTokens.includes(name),
    ),
  );
}

/**
 * Starts the HTTP forward proxy a Chromium render sends all its traffic through. Each
 * destination's hostname is resolved once per proxy, the connection is refused if any of its
 * addresses is blocked, and otherwise the proxy connects to the address it checked, so
 * Chromium's own resolver never decides where a render's traffic goes. Listens on 127.0.0.1
 * only and serves only callers that present its per-launch credentials.
 */
export async function startEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const resolve = options.resolve ?? resolveWithSystem;
  const isDestinationAllowed = options.isDestinationAllowed ?? isPublicAddress;
  const credentials: ProxyCredentials = {
    username: 'render',
    password: randomBytes(24).toString('base64url'),
  };
  const expectedAuthorization = Buffer.from(
    `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
  );

  const resolutions = new Map<string, Promise<string[]>>();
  const refused = new Set<string>();
  const sockets = new Set<Socket>();

  function track(socket: Socket): void {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  }

  function isAuthorized(req: IncomingMessage): boolean {
    const presented = Buffer.from(req.headers['proxy-authorization'] ?? '');
    return presented.length === expectedAuthorization.length && timingSafeEqual(presented, expectedAuthorization);
  }

  // Memoised for the proxy's lifetime (one render), so a name keeps the address it was
  // checked with however its DNS answers change while the page loads.
  function resolveOnce(hostname: string): Promise<string[]> {
    if (net.isIP(hostname)) return Promise.resolve([hostname]);
    let resolution = resolutions.get(hostname);
    if (!resolution) {
      resolution = resolve(hostname).catch(() => []);
      resolutions.set(hostname, resolution);
    }
    return resolution;
  }

  async function checkDestination(hostname: string, port: number): Promise<{ reason: string } | { address: string }> {
    if (options.refuseAll) return { reason: 'this render has no network access' };
    const addresses = await resolveOnce(hostname);
    if (addresses.length === 0) return { reason: 'it does not resolve' };
    if (addresses.some((address) => !isDestinationAllowed(address, port))) {
      return { reason: `it resolves to a blocked address (${addresses.join(', ')})` };
    }
    return { address: addresses[0] };
  }

  /** The address to connect to, or null after logging why the destination is refused. */
  async function validatedAddress(hostname: string, port: number, logged: string): Promise<string | null> {
    const checked = await checkDestination(hostname, port);
    if ('address' in checked) return checked.address;
    refused.add(destinationKey(hostname, port));
    console.warn(`[render-egress] refused ${logged}: ${checked.reason}`);
    return null;
  }

  function refuseHttp(res: ServerResponse, status: 400 | 403 | 407): void {
    const headers: http.OutgoingHttpHeaders = { 'content-type': 'text/plain', connection: 'close' };
    if (status === 407) headers['proxy-authenticate'] = `Basic realm="${PROXY_REALM}"`;
    res.writeHead(status, headers);
    res.end();
  }

  function refuseTunnel(client: Socket, status: 400 | 403 | 407 | 502): void {
    const reason = { 400: 'Bad Request', 403: 'Forbidden', 407: 'Proxy Authentication Required', 502: 'Bad Gateway' }[status];
    const authenticate = status === 407 ? `Proxy-Authenticate: Basic realm="${PROXY_REALM}"\r\n` : '';
    client.end(`HTTP/1.1 ${status} ${reason}\r\n${authenticate}Content-Length: 0\r\nConnection: close\r\n\r\n`);
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAuthorized(req)) return refuseHttp(res, 407);

    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      return refuseHttp(res, 400);
    }
    if (target.protocol !== 'http:') return refuseHttp(res, 400);
    if (target.hostname === PRIME_HOST) {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': 0 });
      res.end();
      return;
    }

    const port = Number(target.port || 80);
    const address = await validatedAddress(
      normalizeHostname(target.hostname),
      port,
      `${target.origin}${target.pathname}`,
    );
    if (!address) return refuseHttp(res, 403);

    const upstream = http.request({
      host: address,
      port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers: forwardableHeaders(req.headers),
      setHost: false,
      agent: false,
    });
    upstream.on('socket', track);
    upstream.on('response', (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, forwardableHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    });
    upstream.on('error', () => {
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(502, { connection: 'close' });
        res.end();
      }
    });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  async function handleConnect(req: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    client.on('error', () => client.destroy());
    if (!isAuthorized(req)) return refuseTunnel(client, 407);

    const target = parseConnectTarget(req.url ?? '');
    if (!target) return refuseTunnel(client, 400);

    const address = await validatedAddress(target.hostname, target.port, `${target.hostname}:${target.port}`);
    if (!address) return refuseTunnel(client, 403);
    if (client.destroyed) return;

    const upstream = net.connect({ host: address, port: target.port });
    track(upstream);
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => {
      if (upstream.connecting) refuseTunnel(client, 502);
      else client.destroy();
    });
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => res.destroy());
  });
  server.on('connect', (req: IncomingMessage, client: Socket, head: Buffer) => {
    handleConnect(req, client, head).catch(() => client.destroy());
  });
  server.on('connection', track);

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const { port } = server.address() as AddressInfo;

  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}`,
    primeUrl: `http://${PRIME_HOST}/`,
    port,
    credentials,
    wasRefused: (hostname, destinationPort) => refused.has(destinationKey(hostname, destinationPort)),
    close() {
      closing ??= new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}
