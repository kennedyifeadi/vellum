// Imported by the verify page as well, so nothing here may need Node.

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;
export const CODE_GROUP_LENGTH = 4;
const MAX_CODE_INPUT_LENGTH = 32;
const CODE_CHARACTERS = new RegExp(`^[${CODE_ALPHABET}]*$`, 'i');

const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

/** What was entered without spaces and hyphens, in capitals, or null if any of it cannot be in a code. */
export function readCodeCharacters(value: string): string | null {
  const characters = value.replace(/[\s-]/g, '');
  // Tested before upper-casing, which turns some non-ASCII letters into ASCII ones.
  return CODE_CHARACTERS.test(characters) ? characters.toUpperCase() : null;
}

export function parseOtpCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_CODE_INPUT_LENGTH) return null;
  const characters = readCodeCharacters(value);
  return characters?.length === CODE_LENGTH ? characters : null;
}

export function formatOtpCode(code: string): string {
  return `${code.slice(0, CODE_GROUP_LENGTH)}-${code.slice(CODE_GROUP_LENGTH)}`;
}

export function isJsonRequest(req: Request): boolean {
  return JSON_CONTENT_TYPE.test(req.headers.get('content-type') ?? '');
}
