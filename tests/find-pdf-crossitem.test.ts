import {
  buildPageStream,
  dehyphenate,
  findMatchRanges,
  itemsForRange,
  findInItems,
  type TextItemLike,
} from '@/lib/pdf/findPdfStream';

function line(str: string, y: number, hasEOL: boolean): TextItemLike {
  return { str, hasEOL, width: str.length * 6, height: 12, transform: [12, 0, 0, 12, 30, y] };
}

// One text item per visual line, each flagged hasEOL — the shape pdfjs produces for a
// Chrome-generated PDF. A phrase spanning a line wrap therefore spans items.
const wrappedParagraph: TextItemLike[] = [
  line('The board reviewed the integration timeline for the', 250, true),
  line('company highlighted in the quarterly report, noting that', 228, true),
  line('operating margins expand once the twenty-', 206, true),
  line('ninth workstream closes and the multi-', 184, true),
  line('page appendix is finalised.', 162, false),
];

describe('buildPageStream', () => {
  it('joins abutting runs with no separator', () => {
    const { text } = buildPageStream([
      { str: 'Hello', hasEOL: false, width: 30, transform: [10, 0, 0, 10, 0, 0] },
      { str: 'World', hasEOL: false, width: 30, transform: [10, 0, 0, 10, 30, 0] },
    ]);
    expect(text).toBe('HelloWorld');
  });

  it('inserts a space when runs are visibly separated on the same line', () => {
    const { text } = buildPageStream([
      { str: 'Hello', hasEOL: false, width: 30, transform: [10, 0, 0, 10, 0, 0] },
      { str: 'World', hasEOL: false, width: 30, transform: [10, 0, 0, 10, 45, 0] },
    ]);
    expect(text).toBe('Hello World');
  });

  it('renders a wrapped line (hasEOL) as a single space', () => {
    const { text } = buildPageStream([
      { str: 'Hello', hasEOL: true, width: 30, transform: [10, 0, 0, 10, 0, 20] },
      { str: 'World', hasEOL: false, width: 30, transform: [10, 0, 0, 10, 0, 0] },
    ]);
    expect(text).toBe('Hello World');
  });

  it('does not double a space that a run already carries', () => {
    const { text } = buildPageStream([
      { str: 'Hello ', hasEOL: false, width: 36, transform: [10, 0, 0, 10, 0, 0] },
      { str: 'World', hasEOL: false, width: 30, transform: [10, 0, 0, 10, 90, 0] },
    ]);
    expect(text).toBe('Hello World');
  });

  it('records a stream span for every item', () => {
    const items: TextItemLike[] = [
      { str: 'ab', hasEOL: true, transform: [10, 0, 0, 10, 0, 20] },
      { str: 'cd', hasEOL: false, transform: [10, 0, 0, 10, 0, 0] },
    ];
    const { text, ranges } = buildPageStream(items);
    expect(text).toBe('ab cd');
    expect(ranges).toEqual([
      { itemIndex: 0, start: 0, end: 2 },
      { itemIndex: 1, start: 3, end: 5 },
    ]);
  });
});

describe('dehyphenate', () => {
  it('joins a hyphen broken across a line', () => {
    expect(dehyphenate('twenty- ninth').text).toBe('twentyninth');
    expect(dehyphenate('twenty-\nninth').text).toBe('twentyninth');
  });

  it('leaves a real in-word hyphen alone', () => {
    expect(dehyphenate('well-known figure').text).toBe('well-known figure');
  });

  it('maps every output character back to its source index', () => {
    const { text, map } = dehyphenate('a- b');
    expect(text).toBe('ab');
    expect(map).toEqual([0, 3]);
  });
});

describe('findMatchRanges', () => {
  it('is case-insensitive', () => {
    expect(findMatchRanges('The Quick Fox', 'quick')).toEqual([{ start: 4, end: 9 }]);
  });

  it('counts overlapping occurrences', () => {
    expect(findMatchRanges('aaaa', 'aa')).toHaveLength(3);
  });

  it('returns nothing for an empty term', () => {
    expect(findMatchRanges('anything', '')).toEqual([]);
  });
});

describe('itemsForRange', () => {
  const ranges = [
    { itemIndex: 0, start: 0, end: 5 },
    { itemIndex: 1, start: 6, end: 11 },
  ];

  it('returns only the item a match falls inside', () => {
    expect(itemsForRange({ start: 1, end: 4 }, ranges)).toEqual([0]);
  });

  it('returns every item a match spans', () => {
    expect(itemsForRange({ start: 3, end: 9 }, ranges)).toEqual([0, 1]);
  });
});

describe('findInItems', () => {
  it('still finds and counts a phrase that sits within one item', () => {
    const { matches, matchCount } = findInItems(wrappedParagraph, 'integration timeline');
    expect(matchCount).toBe(1);
    expect(matches[0].itemIndices).toEqual([0]);
    expect(matches[0].snippet).toContain('integration timeline');
  });

  it('finds a phrase that straddles a line wrap and highlights both lines', () => {
    const { matches, matchCount } = findInItems(wrappedParagraph, 'the company');
    expect(matchCount).toBe(1);
    expect(matches[0].itemIndices).toEqual([0, 1]);
  });

  it('finds a phrase spanning three items', () => {
    const { matches, matchCount } = findInItems(wrappedParagraph, 'that operating margins');
    expect(matchCount).toBe(1);
    expect(matches[0].itemIndices).toEqual([1, 2]);
  });

  it('recovers a hyphenated word broken across a line wrap', () => {
    const { matches, matchCount } = findInItems(wrappedParagraph, 'twenty-ninth');
    expect(matchCount).toBe(1);
    expect(matches[0].itemIndices).toEqual([2, 3]);
  });

  it('recovers the hyphenated word when queried without the hyphen', () => {
    const { matchCount } = findInItems(wrappedParagraph, 'twentyninth');
    expect(matchCount).toBe(1);
  });

  it('recovers a second hyphenated wrap on the same page', () => {
    const { matches, matchCount } = findInItems(wrappedParagraph, 'multi-page');
    expect(matchCount).toBe(1);
    expect(matches[0].itemIndices).toEqual([3, 4]);
  });

  it('reports nothing for a term that is genuinely absent', () => {
    const { matches, matchCount } = findInItems(wrappedParagraph, 'nonexistent phrase');
    expect(matchCount).toBe(0);
    expect(matches).toEqual([]);
  });

  it('counts every occurrence in the normalised stream', () => {
    const items: TextItemLike[] = [
      { str: 'alpha beta alpha', hasEOL: true, transform: [10, 0, 0, 10, 0, 20] },
      { str: 'alpha gamma', hasEOL: false, transform: [10, 0, 0, 10, 0, 0] },
    ];
    expect(findInItems(items, 'alpha').matchCount).toBe(3);
  });

  it('does not double-count a match that the hyphen pass also sees', () => {
    const items: TextItemLike[] = [
      { str: 'the cat sat', hasEOL: true, transform: [10, 0, 0, 10, 0, 20] },
      { str: 'on the mat', hasEOL: false, transform: [10, 0, 0, 10, 0, 0] },
    ];
    expect(findInItems(items, 'the').matchCount).toBe(2);
  });
});
