import { isIP } from 'net';
import { getClientIp } from '@/lib/http/client-ip';

/**
 * The client address that sign-in counts sends under, or null when none can be trusted.
 * One subscriber usually holds a whole IPv6 /64, so those count as one.
 */
export function signInAddress(headers: Headers): string | null {
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
