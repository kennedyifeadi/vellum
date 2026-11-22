/** Matches the rows their owner may still see: from expiresAt on, a row is gone to them. */
export function unexpired() {
  return { expiresAt: { $gt: new Date() } };
}
