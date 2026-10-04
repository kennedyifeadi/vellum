import { ClientError } from '@/lib/convert/errors';
import { assertLineCountWithinPlan, assertPageCountWithinPlan } from '@/lib/convert/pdf-to-docx-limits';

const PAGE_CAPS: [string, number][] = [
  ['Free', 100],
  ['Basic', 200],
  ['Pro', 300],
  ['Enterprise', 500],
];

const LINE_CAPS: [string, number][] = [
  ['Free', 8000],
  ['Basic', 16000],
  ['Pro', 24000],
  ['Enterprise', 40000],
];

describe('pdf-to-docx page cap', () => {
  it.each(PAGE_CAPS)('allows a %s plan exactly %d pages', (plan, cap) => {
    expect(() => assertPageCountWithinPlan(plan, cap)).not.toThrow();
  });

  it.each(PAGE_CAPS)('rejects a %s plan one page over %d', (plan, cap) => {
    expect(() => assertPageCountWithinPlan(plan, cap + 1)).toThrow(ClientError);
  });

  it('treats a missing plan as a guest', () => {
    expect(() => assertPageCountWithinPlan(undefined, 101)).toThrow(ClientError);
  });

  it('tells the user both their page count and their limit', () => {
    expect(() => assertPageCountWithinPlan('Basic', 1200)).toThrow(
      'This PDF has 1,200 pages; your plan allows converting up to 200 pages to Word.'
    );
  });

  it('rejects with a 400', () => {
    expect(() => assertPageCountWithinPlan('Free', 101)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('pdf-to-docx text cap', () => {
  it.each(LINE_CAPS)('allows a %s plan exactly %d lines', (plan, cap) => {
    expect(() => assertLineCountWithinPlan(plan, cap)).not.toThrow();
  });

  it.each(LINE_CAPS)('rejects a %s plan one line over %d', (plan, cap) => {
    expect(() => assertLineCountWithinPlan(plan, cap + 1)).toThrow(ClientError);
  });

  it('tells the user both their line count and their limit', () => {
    expect(() => assertLineCountWithinPlan('Free', 259000)).toThrow(
      'This PDF has 259,000 lines of text; your plan allows converting up to 8,000 lines to Word.'
    );
  });

  it('rejects with a 400', () => {
    expect(() => assertLineCountWithinPlan('Free', 8001)).toThrow(expect.objectContaining({ status: 400 }));
  });
});
