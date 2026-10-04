import { ClientError } from '@/lib/convert/errors';

const XML_ILLEGAL_CHARS = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
const XML_WHITESPACE = /[\u0009\u000A\u000D ]/g;

// A font with no ToUnicode map extracts its spaces, digits and punctuation as control
// characters: 23% of the characters on a Chrome-made page with the maps removed. Real
// text carries at most a stray one, so anything past 10% is garbage, not a document.
const MAX_ILLEGAL_CHAR_RATIO = 0.1;

export const NO_SELECTABLE_TEXT_MESSAGE =
  "This PDF has no selectable text (it looks scanned or image-only), so it can't be converted to an editable document.";

export interface ExtractedPage {
  num: number;
  text: string;
}

export interface ConvertiblePage {
  num: number;
  hasText: boolean;
  lines: string[];
}

export function stripXmlIllegalChars(text: string): string {
  return text.replace(XML_ILLEGAL_CHARS, '');
}

function countCodePoints(text: string): number {
  return Array.from(text).length;
}

function illegalCharRatio(text: string): number {
  const charCount = countCodePoints(text.replace(XML_WHITESPACE, ''));
  if (charCount === 0) return 0;
  return (text.match(XML_ILLEGAL_CHARS)?.length ?? 0) / charCount;
}

/**
 * Turns pdf-parse's per-page text into lines that are safe to write into a DOCX.
 * Throws a `ClientError` when the PDF has nothing usable to convert.
 */
export function toConvertiblePages(pages: ExtractedPage[]): ConvertiblePage[] {
  const rawText = pages.map((page) => page.text).join('\n');
  if (illegalCharRatio(rawText) > MAX_ILLEGAL_CHAR_RATIO) {
    throw new ClientError(NO_SELECTABLE_TEXT_MESSAGE);
  }

  const convertible = pages.map((page) => {
    const text = stripXmlIllegalChars(page.text);
    return { num: page.num, hasText: text.trim() !== '', lines: text.split('\n') };
  });

  if (!convertible.some((page) => page.hasText)) {
    throw new ClientError(NO_SELECTABLE_TEXT_MESSAGE);
  }
  return convertible;
}

export function missingTextPlaceholder(pageNum: number): string {
  return `[Page ${pageNum} had no extractable text — it may be an image or a scan.]`;
}
