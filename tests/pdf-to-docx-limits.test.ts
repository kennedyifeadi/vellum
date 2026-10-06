import { ClientError } from '@/lib/convert/errors';
import {
  assertFileSizeWithinPlan,
  assertLineCountWithinPlan,
  assertPageCountWithinPlan,
} from '@/lib/convert/pdf-to-docx-limits';

const MB = 1024 * 1024;

const SIZE_CAPS_MB: [string, number][] = [
  ['Free', 5],
  ['Basic', 10],
  ['Pro', 15],
  ['Enterprise', 25],
];

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

describe('pdf-to-docx size cap', () => {
  it.each(SIZE_CAPS_MB)('allows a %s plan exactly %d MB', (plan, capMb) => {
    expect(() => assertFileSizeWithinPlan(plan, capMb * MB)).not.toThrow();
  });

  it.each(SIZE_CAPS_MB)('rejects a %s plan one byte over %d MB with a 400 naming that limit', (plan, capMb) => {
    expect.assertions(3);
    try {
      assertFileSizeWithinPlan(plan, capMb * MB + 1);
    } catch (error) {
      expect(error).toBeInstanceOf(ClientError);
      expect((error as ClientError).status).toBe(400);
      expect((error as ClientError).message).toContain(`up to ${capMb} MB to Word`);
    }
  });

  it.each([
    ['an unknown', 'Platinum'],
    ['a null', null],
    ['an undefined', undefined],
  ])('holds %s plan to the guest cap', (_label, plan) => {
    expect(() => assertFileSizeWithinPlan(plan, 5 * MB)).not.toThrow();
    expect(() => assertFileSizeWithinPlan(plan, 5 * MB + 1)).toThrow('up to 5 MB to Word');
  });

  it('tells the user their file size, their limit and that it is specific to PDF to Word', () => {
    expect(() => assertFileSizeWithinPlan('Basic', 12.34 * MB)).toThrow(
      'This PDF is 12.4 MB; your plan allows converting PDFs up to 10 MB to Word. This limit is specific to PDF to Word and is lower than the general upload limit.'
    );
  });

  it('never reports an over-cap file as being exactly at the cap', () => {
    expect(() => assertFileSizeWithinPlan('Free', 5 * MB + 1)).toThrow('This PDF is 5.1 MB;');
  });
});

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
