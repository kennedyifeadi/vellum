import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { ClientError } from '@/lib/convert/errors';

const NAVIGABLE_SCHEMES = new Set(['http:', 'https:']);
const INERT_SCHEMES = new Set(['about:', 'data:', 'blob:']);

/**
 * The one answer for every destination refused: an internal name, a non-public address, a
 * name that does not resolve, or a redirect to any of these. Saying which would tell a caller
 * what exists on the server's network.
 */
export const DESTINATION_REFUSED_MESSAGE = "That URL can't be converted. It must be a public http or https address.";

const BLOCKED_HOSTNAMES = new Set(['localhost']);
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.internal', '.local'];

type Screened = { reason: string } | { hostname: string } | { inert: true };

/**
 * The checks that need no DNS: the URL parses, its scheme is http/https, and its host is not
 * an internal name. `allowInertSchemes` is set only for sub-resource requests already inside
 * the page (request interception), where `data:`/`blob:`/`about:` carry no egress and blocking
 * them would break ordinary self-contained documents.
 */
function screenUrlShape(rawUrl: string, { allowInertSchemes }: { allowInertSchemes: boolean }): Screened {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { reason: 'The URL is not valid.' };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (allowInertSchemes && INERT_SCHEMES.has(scheme)) {
    return { inert: true };
  }
  if (!NAVIGABLE_SCHEMES.has(scheme)) {
    return { reason: `Only http and https URLs can be converted (received "${scheme.replace(/:$/, '')}").` };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname) {
    return { reason: 'The URL has no host.' };
  }
  if (isBlockedHostname(hostname)) {
    return { reason: DESTINATION_REFUSED_MESSAGE };
  }
  return { hostname };
}

/**
 * Throws a 400 `ClientError` if `rawUrl` may not be navigated to. Checked before a browser
 * launches, so a plainly internal URL is refused without one; the render's egress proxy
 * checks the addresses it actually connects to.
 */
export async function assertNavigableUrl(rawUrl: string): Promise<void> {
  const screened = screenUrlShape(rawUrl, { allowInertSchemes: false });
  if ('reason' in screened) {
    throw new ClientError(screened.reason);
  }
  if (!('hostname' in screened)) return;

  const { hostname } = screened;
  const addresses = isIP(hostname) ? [hostname] : await resolveHost(hostname);
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new ClientError(DESTINATION_REFUSED_MESSAGE);
  }
}

/**
 * The request-interception check: scheme and host name only, with no DNS. A literal IP is
 * checked here too since that needs no lookup; every other address is the egress proxy's.
 */
export function isRequestAllowed(rawUrl: string): boolean {
  const screened = screenUrlShape(rawUrl, { allowInertSchemes: true });
  if ('reason' in screened) return false;
  if (!('hostname' in screened)) return true;
  return !(isIP(screened.hostname) && isBlockedAddress(screened.hostname));
}

/** Whether `rawUrl` is a data:, blob: or about: URL, which loads nothing from the network. */
export function isInertUrl(rawUrl: string): boolean {
  try {
    return INERT_SCHEMES.has(new URL(rawUrl).protocol.toLowerCase());
  } catch {
    return false;
  }
}

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return true;
  }
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

async function resolveHost(hostname: string): Promise<string[]> {
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch {
    return [];
  }
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    return isBlockedIpv4(ip);
  }
  if (kind === 6) {
    return isBlockedIpv6(ip);
  }
  return true;
}

function ipv4ToInt(ip: string): number | null {
  const octets = ip.split('.');
  if (octets.length !== 4) {
    return null;
  }
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) {
      return null;
    }
    const n = Number(octet);
    if (n > 255) {
      return null;
    }
    value = value * 256 + n;
  }
  return value >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) {
    return true;
  }
  const inRange = (base: string, bits: number): boolean => {
    const baseValue = ipv4ToInt(base);
    if (baseValue === null) {
      return false;
    }
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (baseValue & mask);
  };

  return (
    inRange('0.0.0.0', 8) || // current network / unspecified
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // carrier-grade NAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local, incl. cloud metadata 169.254.169.254
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.0.2.0', 24) || // TEST-NET-1 documentation
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('198.51.100.0', 24) || // TEST-NET-2 documentation
    inRange('203.0.113.0', 24) || // TEST-NET-3 documentation
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved / limited broadcast
  );
}

// Checked on the expanded groups, so every spelling of an address (compressed, full, or with
// a dotted IPv4 tail) is judged the same.
function isBlockedIpv6(ip: string): boolean {
  const groups = expandIpv6(ip.toLowerCase().split('%')[0]);
  if (!groups) {
    return true;
  }
  const [g0, g1, g2, g3, g4, g5] = groups;
  const embeddedIpv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff) {
      return isBlockedIpv4(embeddedIpv4); // ::ffff:0:0/96 IPv4-mapped
    }
    if (g5 === 0) {
      return true; // ::/96 unspecified, loopback, deprecated IPv4-compatible
    }
  }
  return (
    (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) || // 64:ff9b::/96 NAT64
    (g0 === 0x0064 && g1 === 0xff9b && g2 === 0x0001) || // 64:ff9b:1::/48 local-use NAT64
    (g0 === 0x2001 && g1 === 0) || // 2001::/32 Teredo
    g0 === 0x2002 || // 2002::/16 6to4
    (g0 & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g0 & 0xffc0) === 0xfec0 || // fec0::/10 deprecated site-local
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g0 & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

function expandIpv6(addr: string): number[] | null {
  const halves = addr.split('::');
  if (halves.length > 2) {
    return null;
  }

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') {
      return [];
    }
    const parts = segment.split(':');
    const groups: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1 && part.includes('.')) {
        const embedded = ipv4ToInt(part);
        if (embedded === null) {
          return null;
        }
        groups.push((embedded >>> 16) & 0xffff, embedded & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) {
        return null;
      }
      groups.push(parseInt(part, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tail) {
    return null;
  }

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) {
      return null;
    }
    return [...head, ...new Array(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}
