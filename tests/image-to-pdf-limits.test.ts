import { ClientError } from '@/lib/convert/errors';
import {
  assertFileCountWithinPlan,
  assertPixelCountWithinLimit,
  assertTotalSizeWithinPlan,
  conversionLimitsForPlan,
  IMAGE_TO_PDF_BUSY_MESSAGE,
  IMAGES_TOO_COMPLEX_MESSAGE,
} from '@/lib/convert/image-to-pdf-limits';
import { extractionOptionsForPlan as findPdfExtractionOptionsForPlan } from '@/lib/convert/find-pdf-limits';

const MB = 1024 * 1024;

const CONVERSION_DEADLINES_S: [string, number][] = [
  ['Free', 30],
  ['Basic', 60],
  ['Pro', 90],
  ['Enterprise', 120],
];

const FILE_CAPS: [string, number][] = [
  ['Free', 3],
  ['Basic', 30],
  ['Pro', 50],
  ['Enterprise', 250],
];

const SIZE_CAPS_MB: [string, number][] = [
  ['Free', 25],
  ['Basic', 50],
  ['Pro', 100],
  ['Enterprise', 500],
];

describe('image-to-pdf conversion limits', () => {
  it.each(CONVERSION_DEADLINES_S)('gives a %s plan %d seconds to convert', (plan, seconds) => {
    expect(conversionLimitsForPlan(plan).deadlineMs).toBe(seconds * 1000);
  });

  it('gives a guest and an unknown plan the guest deadline', () => {
    expect(conversionLimitsForPlan(null).deadlineMs).toBe(30_000);
    expect(conversionLimitsForPlan('Platinum').deadlineMs).toBe(30_000);
  });

  it('bounds the worker like the PDF tools, whose slots it shares', () => {
    const { maxHeapMb, maxConcurrent } = findPdfExtractionOptionsForPlan('Free');

    expect(conversionLimitsForPlan('Free')).toMatchObject({ maxHeapMb: 256, maxConcurrent: 2 });
    expect(conversionLimitsForPlan('Enterprise')).toMatchObject({ maxHeapMb, maxConcurrent });
  });

  it('words its refusals for images', () => {
    expect(IMAGES_TOO_COMPLEX_MESSAGE).toBe(
      'These images are too complex to convert to PDF. Converting fewer or smaller images at a time may help.',
    );
    expect(IMAGE_TO_PDF_BUSY_MESSAGE).toBe('Image to PDF is busy right now. Please try again in a few seconds.');
  });
});

describe('image-to-pdf caps', () => {
  it.each(FILE_CAPS)('allows a %s plan %d files', (plan, cap) => {
    expect(() => assertFileCountWithinPlan(plan, cap)).not.toThrow();
    expect(() => assertFileCountWithinPlan(plan, cap + 1)).toThrow(
      new ClientError(`Your current plan allows up to ${cap} files per conversion.`),
    );
  });

  it.each(SIZE_CAPS_MB)('allows a %s plan %d MB in all', (plan, capMb) => {
    expect(() => assertTotalSizeWithinPlan(plan, [capMb * MB - 10, 10])).not.toThrow();
    expect(() => assertTotalSizeWithinPlan(plan, [capMb * MB - 10, 11])).toThrow(
      new ClientError(`Your current plan allows up to ${capMb}MB of images per conversion.`),
    );
  });

  it('allows an image of exactly 50 megapixels and refuses one pixel row more', () => {
    expect(() => assertPixelCountWithinLimit(1, 10_000, 5_000)).not.toThrow();
    expect(() => assertPixelCountWithinLimit(4, 10_000, 5_001)).toThrow(
      new ClientError('Image 4 is 50.1 megapixels. Each image can be at most 50 megapixels.'),
    );
  });
});
