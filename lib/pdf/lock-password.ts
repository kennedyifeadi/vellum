export const MIN_LOCK_PASSWORD_LENGTH = 8;
const MAX_LOCK_PASSWORD_BYTES = 127;

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** The password bytes AES-256 hashes: UTF-8 of the NFKC form, as ISO 32000-2 prepares them. */
export function lockPasswordBytes(password: string): Uint8Array {
  return new TextEncoder().encode(password.normalize('NFKC'));
}

// Shared by the Lock PDF route and its form, so the form enables Process exactly when the
// server would accept the password. Length counts code points, so an emoji is one character.
// AES-256 hashes at most 127 bytes, so anything longer would be silently ignored. Control
// characters (including NUL) have no portable encoding in the password string and produce
// files a spec-compliant reader cannot reopen, so they are rejected rather than encrypted.
export function validateLockPassword(password: unknown): string | null {
  if (typeof password !== 'string' || [...password.normalize('NFKC')].length < MIN_LOCK_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_LOCK_PASSWORD_LENGTH} characters.`;
  }
  if (lockPasswordBytes(password).length > MAX_LOCK_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_LOCK_PASSWORD_BYTES} bytes.`;
  }
  if (hasControlCharacter(password)) {
    return 'Password must not contain control characters.';
  }
  return null;
}
