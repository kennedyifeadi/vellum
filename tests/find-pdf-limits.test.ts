import { ClientError } from '@/lib/convert/errors';
import {
  assertFileSizeWithinPlan,
  assertPageCountWithinPlan,
  extractionOptionsForPlan,
} from '@/lib/convert/find-pdf-limits';
import { extractionOptionsForPlan as pdfToDocxExtractionOptionsForPlan } from '@/lib/convert/pdf-to-docx-limits';

const MB = 1024 * 1024;

const SIZE_CAPS_MB: [string, number][] = [
  ['Free', 25],
  ['Basic', 50],
  ['Pro', 100],
  ['Enterprise', 500],
];

const PAGE_CAPS: [string, number][] = [
  ['Free', 10],
  ['Basic', 50],
  ['Pro', 100],
  ['Enterprise', 500],
];

const EXTRACTION_DEADLINES_S: [string, number][] = [
  ['Free', 5],
  ['Basic', 10],
  ['Pro', 15],
  ['Enterprise', 45],
];

describe('find-pdf extraction limits', () => {
  it.each(EXTRACTION_DEADLINES_S)('gives a %s plan %d seconds to extract', (plan, seconds) => {
    expect(extractionOptionsForPlan(plan).deadlineMs).toBe(seconds * 1000);
  });

  it.each(PAGE_CAPS)('stops a %s plan extracting past %d pages', (plan, cap) => {
    expect(extractionOptionsForPlan(plan).maxPages).toBe(cap);
  });

  it('holds an unknown plan to the guest limits', () => {
    expect(extractionOptionsForPlan('Platinum')).toEqual(extractionOptionsForPlan(null));
    expect(extractionOptionsForPlan('Platinum').deadlineMs).toBe(5000);
  });

  it('runs under the heap limit and the concurrency limit PDF to Word runs under', () => {
    const { maxHeapMb, maxConcurrent } = extractionOptionsForPlan('Enterprise');

    expect({ maxHeapMb, maxConcurrent }).toEqual({ maxHeapMb: 256, maxConcurrent: 2 });
    expect(pdfToDocxExtractionOptionsForPlan('Enterprise')).toMatchObject({ maxHeapMb, maxConcurrent });
  });
});

describe('find-pdf size cap', () => {
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
      expect((error as ClientError).message).toBe(`Your current plan allows PDFs up to ${capMb}MB.`);
    }
  });

  it.each([
    ['an unknown', 'Platinum'],
    ['a null', null],
    ['an undefined', undefined],
  ])('holds %s plan to the guest cap', (_label, plan) => {
    expect(() => assertFileSizeWithinPlan(plan, 25 * MB)).not.toThrow();
    expect(() => assertFileSizeWithinPlan(plan, 25 * MB + 1)).toThrow('up to 25MB');
  });
});

describe('find-pdf page cap', () => {
  it.each(PAGE_CAPS)('allows a %s plan exactly %d pages', (plan, cap) => {
    expect(() => assertPageCountWithinPlan(plan, cap)).not.toThrow();
  });

  it.each(PAGE_CAPS)('rejects a %s plan one page over %d with a 400 naming that limit', (plan, cap) => {
    expect.assertions(3);
    try {
      assertPageCountWithinPlan(plan, cap + 1);
    } catch (error) {
      expect(error).toBeInstanceOf(ClientError);
      expect((error as ClientError).status).toBe(400);
      expect((error as ClientError).message).toBe(
        `Your current plan allows searching up to ${cap} pages per document.`,
      );
    }
  });

  it('treats a missing plan as a guest', () => {
    expect(() => assertPageCountWithinPlan(undefined, 11)).toThrow(ClientError);
  });
});
