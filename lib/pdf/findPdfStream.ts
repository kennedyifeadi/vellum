/**
 * Cross-item text search for the Find-in-PDF route.
 *
 * pdfjs splits a page's text into many `TextItem`s — Chrome-generated PDFs break at
 * every visual line — so matching each item in isolation misses any query that spans
 * a line wrap or a hyphenated break (issue #58). These helpers concatenate a page's
 * items into a single normalised stream, run the match there, and map each hit back to
 * the item(s) it overlaps so the existing per-item highlight logic still applies.
 */

export interface TextItemLike {
  str: string;
  hasEOL?: boolean;
  width?: number;
  height?: number;
  transform?: number[];
}

/** Half-open span `[start, end)` in stream coordinates owned by one text item. */
export interface StreamItemRange {
  itemIndex: number;
  start: number;
  end: number;
}

export interface PageStream {
  text: string;
  ranges: StreamItemRange[];
}

export interface StreamMatch {
  /** Indices (into the item array passed to `findInItems`) this match overlaps. */
  itemIndices: number[];
  /** The matched text as it appears in the stream. */
  text: string;
  /** +/-20 chars of stream context around the match. */
  snippet: string;
}

export interface FindInItemsResult {
  matches: StreamMatch[];
  matchCount: number;
}

function fontHeight(item: TextItemLike): number {
  return Math.abs(item.transform?.[3] ?? item.height ?? 0) || 10;
}

/**
 * Whitespace pdfjs would render between two consecutive items: nothing when the runs
 * abut, otherwise a single space. A wrapped line (`hasEOL`) reads as a space in prose
 * order, so a query typed with spaces still matches across the wrap; hyphenated wraps
 * (`twenty-\nninth`) are recovered separately in `dehyphenate`.
 */
function separatorBetween(prev: TextItemLike, cur: TextItemLike): string {
  if (prev.str === '' || /\s$/.test(prev.str) || /^\s/.test(cur.str)) return '';
  if (prev.hasEOL) return ' ';

  const prevX = prev.transform?.[4];
  const curX = cur.transform?.[4];
  const prevY = prev.transform?.[5];
  const curY = cur.transform?.[5];
  if (prevX == null || curX == null || prevY == null || curY == null) return ' ';

  const h = fontHeight(prev);
  if (Math.abs(prevY - curY) > h * 0.5) return ' ';

  const gap = curX - (prevX + (prev.width ?? 0));
  return gap > h * 0.25 ? ' ' : '';
}

export function buildPageStream(items: TextItemLike[]): PageStream {
  let text = '';
  const ranges: StreamItemRange[] = [];

  items.forEach((item, idx) => {
    if (idx > 0) text += separatorBetween(items[idx - 1], item);
    const start = text.length;
    text += item.str;
    ranges.push({ itemIndex: idx, start, end: text.length });
  });

  return { text, ranges };
}

/**
 * Stream with hyphenated line breaks joined: a `-` followed by spaces and/or a single
 * newline and then a letter becomes a bare join (`twenty-\nninth` -> `twentyninth`).
 * `map[i]` is the index in the original stream of dehyphenated char `i`.
 */
export function dehyphenate(streamText: string): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];

  for (let i = 0; i < streamText.length; i++) {
    if (streamText[i] === '-') {
      let j = i + 1;
      while (j < streamText.length && (streamText[j] === ' ' || streamText[j] === '\n')) j++;
      if (j > i + 1 && j < streamText.length && /[a-z]/i.test(streamText[j])) {
        i = j - 1; // outer loop's i++ lands on the continuation letter
        continue;
      }
    }
    out.push(streamText[i]);
    map.push(i);
  }

  return { text: out.join(''), map };
}

/** Every occurrence of `term` in `haystack`, case-insensitive, overlapping allowed. */
export function findMatchRanges(
  haystack: string,
  term: string,
): Array<{ start: number; end: number }> {
  const needle = term.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  if (!needle) return out;

  const hay = haystack.toLowerCase();
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    out.push({ start: idx, end: idx + needle.length });
    idx = hay.indexOf(needle, idx + 1);
  }
  return out;
}

export function itemsForRange(
  range: { start: number; end: number },
  ranges: StreamItemRange[],
): number[] {
  const hit: number[] = [];
  for (const r of ranges) {
    if (r.start < range.end && r.end > range.start) hit.push(r.itemIndex);
  }
  return hit;
}

function snippetAround(streamText: string, start: number, end: number): string {
  const from = Math.max(0, start - 20);
  const to = Math.min(streamText.length, end + 20);
  return `...${streamText.slice(from, to).replace(/\s+/g, ' ').trim()}...`;
}

export function findInItems(items: TextItemLike[], term: string): FindInItemsResult {
  const stream = buildPageStream(items);
  const ranges = findMatchRanges(stream.text, term);

  // Best-effort recovery of hyphenated line breaks: match the term (with its own
  // hyphens dropped) against the stream with soft-hyphen joins removed, so a query for
  // `twenty-ninth` finds a document that wrapped it as `twenty-\nninth`.
  const { text: dehyphenated, map } = dehyphenate(stream.text);
  for (const r of findMatchRanges(dehyphenated, term.replace(/-/g, ''))) {
    const start = map[r.start];
    const end = r.end - 1 < map.length ? map[r.end - 1] + 1 : stream.text.length;
    const alreadyFound = ranges.some((existing) => existing.start < end && existing.end > start);
    if (!alreadyFound) ranges.push({ start, end });
  }

  ranges.sort((a, b) => a.start - b.start);

  const matches = ranges.map((r) => ({
    itemIndices: itemsForRange(r, stream.ranges),
    text: stream.text.slice(r.start, r.end),
    snippet: snippetAround(stream.text, r.start, r.end),
  }));

  return { matches, matchCount: ranges.length };
}
