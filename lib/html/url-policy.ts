import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { ClientError } from '@/lib/convert/errors';

const NAVIGABLE_SCHEMES = new Set(['http:', 'https:']);
const INERT_SCHEMES = new Set(['about:', 'data:', 'blob:']);

const BLOCKED_HOSTNAMES = new Set(['localhost']);
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.internal', '.local'];

/**
 * Decides whether a URL may be fetched while rendering user-supplied input to a PDF.
 * `null` means allowed; a string is a caller-safe reason it was rejected.
 *
 * `allowInertSchemes` is set only for sub-resource requests already inside the page
 * (request interception), where `data:`/`blob:`/`about:` carry no egress and blocking
 * them would break ordinary self-contained documents.
 */
async function screenUrl(
  rawUrl: string,
  { allowInertSchemes }: { allowInertSchemes: boolean },
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'The URL is not valid.';
  }

  const scheme = parsed.protocol.toLowerCase();
  if (allowInertSchemes && INERT_SCHEMES.has(scheme)) {
    return null;
  }
  if (!NAVIGABLE_SCHEMES.has(scheme)) {
    return `Only http and https URLs can be converted (received "${scheme.replace(/:$/, '')}").`;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname) {
    return 'The URL has no host.';
  }
  if (isBlockedHostname(hostname)) {
    return 'That URL points to a private or internal host.';
  }

  const literal = isIP(hostname) ? hostname : null;
  const addresses = literal ? [literal] : await resolveHost(hostname);
  if (addresses.length === 0) {
    return 'The URL host could not be resolved.';
  }
  if (addresses.some(isBlockedAddress)) {
    return 'That URL resolves to a private or internal address.';
  }

  return null;
}

/** Throws a 400 `ClientError` if `rawUrl` may not be navigated to. */
export async function assertNavigableUrl(rawUrl: string): Promise<void> {
  const reason = await screenUrl(rawUrl, { allowInertSchemes: false });
  if (reason) {
    throw new ClientError(reason);
  }
}

/** Non-throwing check for the puppeteer request-interception handler. */
export async function isRequestAllowed(rawUrl: string): Promise<boolean> {
  return (await screenUrl(rawUrl, { allowInertSchemes: true })) === null;
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
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved / limited broadcast
  );
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0];

  const dottedMapped = addr.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMapped) {
    return isBlockedIpv4(dottedMapped[1]);
  }
  const hexMapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return isBlockedIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  if (addr === '::' || addr === '::1') {
    return true;
  }

  const groups = expandIpv6(addr);
  if (!groups) {
    return true;
  }
  const first = groups[0];
  if ((first & 0xffc0) === 0xfe80) {
    return true; // fe80::/10 link-local
  }
  if ((first & 0xfe00) === 0xfc00) {
    return true; // fc00::/7 unique local
  }
  if ((first & 0xff00) === 0xff00) {
    return true; // ff00::/8 multicast
  }
  return false;
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
