import { ClientError } from '@/lib/convert/errors';

export const MAX_NAME_LENGTH = 100;

// U+2028 and U+2029 break lines without being control characters.
const NOT_ON_ONE_LINE = /[\p{Cc}\u2028\u2029]/u;

/** The trimmed text of a JSON field that must be given, in at most `maxLength` characters. */
export function requiredText(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null) {
    throw new ClientError(`${label} is required.`);
  }
  if (typeof value !== 'string') {
    throw new ClientError(`${label} must be text.`);
  }
  const text = value.trim();
  if (!text) {
    throw new ClientError(`${label} is required.`);
  }
  if (text.length > maxLength) {
    throw new ClientError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

export function requiredLine(value: unknown, label: string, maxLength: number): string {
  const text = requiredText(value, label, maxLength);
  if (NOT_ON_ONE_LINE.test(text)) {
    throw new ClientError(`${label} must be on one line.`);
  }
  return text;
}

/** A person's name, or undefined when none was given. */
export function optionalName(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredLine(value, 'Name', MAX_NAME_LENGTH);
}
