/** The signed-in user as the server's session check sees them, or null for a guest. */
export async function fetchSignedInUser<User = { plan?: string }>(): Promise<User | null> {
  const res = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user ?? null;
}
