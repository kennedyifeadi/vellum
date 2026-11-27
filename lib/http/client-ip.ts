import { isIP } from 'net';

type HeaderEntry = 'single' | 'leftmost' | 'rightmost';

const HEADER_ENTRIES: readonly HeaderEntry[] = ['single', 'leftmost', 'rightmost'];

function configuredEntry(): HeaderEntry {
  const entry = process.env.CLIENT_IP_HEADER_ENTRY?.trim().toLowerCase() || 'single';
  if (!HEADER_ENTRIES.includes(entry as HeaderEntry)) {
    throw new Error(
      `CLIENT_IP_HEADER_ENTRY must be one of ${HEADER_ENTRIES.join(', ')}; got "${process.env.CLIENT_IP_HEADER_ENTRY}".`,
    );
  }
  return entry as HeaderEntry;
}

function pickEntry(value: string, entry: HeaderEntry): string | null {
  const parts = value.split(',').map((part) => part.trim());
  // A proxy that overwrites the header leaves exactly one address in it. More than one means
  // something appended to a value the client sent, so none of it can be trusted as `single`.
  if (entry === 'single' && parts.length !== 1) return null;
  const picked = entry === 'rightmost' ? parts[parts.length - 1] : parts[0];
  return picked || null;
}

/**
 * The client's address as reported by the reverse proxy in front of the app, or null when
 * none can be trusted. Only the header named by CLIENT_IP_HEADER is read: with it unset,
 * every forwarding header is ignored, because a client can send any of them itself.
 */
export function getClientIp(headers: Headers): string | null {
  const header = process.env.CLIENT_IP_HEADER?.trim();
  if (!header) return null;
  const entry = configuredEntry();
  const value = headers.get(header);
  return value ? pickEntry(value, entry) : null;
}

/**
 * The address a client's requests are counted under, or null when none can be trusted.
 * One subscriber usually holds a whole IPv6 /64, so those count as one.
 */
export function countedClientAddress(headers: Headers): string | null {
  const address = getClientIp(headers);
  if (!address) return null;
  const version = isIP(address);
  if (version === 4) return address;
  return version === 6 ? countedIpv6(address) : null;
}

function countedIpv6(address: string): string {
  // URL writes every spelling of an address one way, but refuses a zone.
  const canonical = new URL(`http://[${address.split('%')[0]}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) {
    const [high, low] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }

  const [head, tail] = canonical.split('::').map((half) => (half ? half.split(':') : []));
  const groups = tail ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail] : head;
  return `${groups.slice(0, 4).join(':')}::/64`;
}
