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
