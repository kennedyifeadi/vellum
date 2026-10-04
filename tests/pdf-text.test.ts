import { ClientError } from '../lib/convert/errors';
import {
  NO_SELECTABLE_TEXT_MESSAGE,
  missingTextPlaceholder,
  stripXmlIllegalChars,
  toConvertiblePages,
} from '../lib/convert/pdf-text';

describe('stripXmlIllegalChars (lib/convert/pdf-text.ts)', () => {
  it.each([
    ['NUL', 'a\u0000b'],
    ['C0 controls', 'a\u0001\u0003\u0008b'],
    ['vertical tab and form feed', 'a\u000B\u000Cb'],
    ['C0 controls above CR', 'a\u000E\u001D\u001Fb'],
    ['U+FFFE and U+FFFF', 'a￾￿b'],
    ['a lone high surrogate', 'a\uD83Db'],
    ['a lone low surrogate', 'a\uDE00b'],
  ])('removes %s', (_label, input) => {
    expect(stripXmlIllegalChars(input)).toBe('ab');
  });

  it('keeps tab, line feed and carriage return', () => {
    expect(stripXmlIllegalChars('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('keeps accents, CJK, private-use and emoji', () => {
    const text = 'café naïve 日本語 한국어  😀 𝒳 �';

    expect(stripXmlIllegalChars(text)).toBe(text);
  });

  it('returns an empty string unchanged', () => {
    expect(stripXmlIllegalChars('')).toBe('');
  });
});

describe('toConvertiblePages (lib/convert/pdf-text.ts)', () => {
  it('splits each page into sanitised lines', () => {
    const pages = toConvertiblePages([{ num: 1, text: 'first\u0001 line\nsecond line' }]);

    expect(pages).toEqual([{ num: 1, hasText: true, lines: ['first line', 'second line'] }]);
  });

  it('flags a page with only whitespace or control characters as text-less', () => {
    const pages = toConvertiblePages([
      { num: 1, text: 'A page of ordinary words that carries the document.' },
      { num: 2, text: ' \n\u0003 ' },
      { num: 3, text: '' },
    ]);

    expect(pages.map((page) => page.hasText)).toEqual([true, false, false]);
  });

  it.each([
    ['no pages', []],
    ['only empty pages', [{ num: 1, text: '' }, { num: 2, text: '' }]],
    ['only whitespace', [{ num: 1, text: ' \n\t \n' }]],
    ['only control characters', [{ num: 1, text: '\u0001\u0003\u001D' }]],
  ])('rejects a document with %s', (_label, pages) => {
    expect(() => toConvertiblePages(pages)).toThrow(new ClientError(NO_SELECTABLE_TEXT_MESSAGE));
  });

  it('rejects text whose spaces and punctuation extracted as control characters', () => {
    const unmapped = '7KH\u0003TXLFN\u0003EURZQ\u0003IR[\u0003MXPSV\u0003RYHU\u0003WKH\u0003OD]\\\u0003GRJ\u0011';

    expect(() => toConvertiblePages([{ num: 1, text: unmapped }])).toThrow(ClientError);
  });

  it('accepts text at the 10% illegal-character boundary and rejects just past it', () => {
    const atBoundary = 'abcdefghi\u0001';
    const pastBoundary = 'abcdefgh\u0001\u0001';

    expect(toConvertiblePages([{ num: 1, text: atBoundary }])[0].lines).toEqual(['abcdefghi']);
    expect(() => toConvertiblePages([{ num: 1, text: pastBoundary }])).toThrow(ClientError);
  });

  it('measures the ratio across the whole document, not per page', () => {
    const pages = toConvertiblePages([
      { num: 1, text: 'A long page of ordinary selectable words that dominates the count.' },
      { num: 2, text: '\u0001\u0001\u0001' },
    ]);

    expect(pages[1].hasText).toBe(false);
  });
});

describe('missingTextPlaceholder (lib/convert/pdf-text.ts)', () => {
  it('names the page that was dropped', () => {
    expect(missingTextPlaceholder(3)).toBe(
      '[Page 3 had no extractable text — it may be an image or a scan.]'
    );
  });
});
