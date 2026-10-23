import { ClientError } from '../lib/convert/errors';
import {
  assertFileSizeWithinPlan,
  ENCODE_COST,
  encodeFitsTimeBudget,
  encodeLimitsForPlan,
  estimateEncodeSeconds,
  longestEncodableSeconds,
  tooMuchWorkMessage,
  VIDEO_TIME_BUDGET_MS,
} from '../lib/convert/video-compress-limits';

const MB = 1024 * 1024;
const PLANS = ['Free', 'Basic', 'Pro', 'Enterprise'];
const COST = { encodeSecondsPerMegapixelFrame: 0.02, decodeSecondsPerMegapixelFrame: 0.005, safetyFactor: 2 };
const FULL_HD = 1920 * 1080;
const SD = 854 * 480;

describe('the Compress Video time budget', () => {
  it('is four minutes, so an encode ends well inside a five-minute silent request', () => {
    expect(VIDEO_TIME_BUDGET_MS).toBe(4 * 60_000);
  });

  it.each(PLANS)('is the same for %s', (plan) => {
    expect(encodeLimitsForPlan(plan).timeBudgetMs).toBe(VIDEO_TIME_BUDGET_MS);
  });

  it('gives an unknown plan the same budget and the guest length cap', () => {
    expect(encodeLimitsForPlan('Platinum')).toEqual({ maxDurationSeconds: 5 * 60, timeBudgetMs: VIDEO_TIME_BUDGET_MS });
  });

  it('still gives each plan its own length cap and size cap', () => {
    expect(PLANS.map((plan) => encodeLimitsForPlan(plan).maxDurationSeconds)).toEqual([300, 900, 1800, 3600]);
    expect(() => assertFileSizeWithinPlan('Free', 50 * MB)).not.toThrow();
    expect(() => assertFileSizeWithinPlan('Free', 50 * MB + 1)).toThrow('up to 50MB');
    expect(() => assertFileSizeWithinPlan('Basic', 100 * MB + 1)).toThrow('up to 100MB');
    expect(() => assertFileSizeWithinPlan('Pro', 500 * MB + 1)).toThrow('up to 500MB');
    expect(() => assertFileSizeWithinPlan('Enterprise', 500 * MB + 1)).toThrow(ClientError);
  });
});

describe('estimateEncodeSeconds', () => {
  it('charges the pixels encoded and the pixels decoded for every frame', () => {
    // 100 frames x (2.0736 MP x 0.02 + 2.0736 MP x 0.005)
    expect(estimateEncodeSeconds({ frames: 100, inputPixels: FULL_HD, outputPixels: FULL_HD }, COST)).toBeCloseTo(5.184, 6);
  });

  it('still charges decoding the full-size input when the output is smaller', () => {
    const scaledDown = estimateEncodeSeconds({ frames: 100, inputPixels: FULL_HD, outputPixels: SD }, COST);
    const nativeSd = estimateEncodeSeconds({ frames: 100, inputPixels: SD, outputPixels: SD }, COST);

    expect(scaledDown - nativeSd).toBeCloseTo((100 * (FULL_HD - SD) * 0.005) / 1e6, 6);
  });

  it('doubles with twice the frames', () => {
    const work = { inputPixels: FULL_HD, outputPixels: SD };
    expect(estimateEncodeSeconds({ frames: 600, ...work }, COST)).toBeCloseTo(2 * estimateEncodeSeconds({ frames: 300, ...work }, COST), 9);
  });

  it('is zero for no frames', () => {
    expect(estimateEncodeSeconds({ frames: 0, inputPixels: FULL_HD, outputPixels: FULL_HD }, COST)).toBe(0);
  });
});

describe('encodeFitsTimeBudget', () => {
  // 1000 frames of 1 MP in and out at 0.025 s each: 25 s, 50 s with the safety factor.
  const work = { frames: 1000, inputPixels: 1_000_000, outputPixels: 1_000_000 };

  it('accepts an estimate that fits exactly with the safety factor', () => {
    expect(encodeFitsTimeBudget(work, 50_000, COST)).toBe(true);
  });

  it('refuses one that does not', () => {
    expect(encodeFitsTimeBudget(work, 49_999, COST)).toBe(false);
  });

  it('refuses everything when no budget is left', () => {
    expect(encodeFitsTimeBudget({ ...work, frames: 1 }, 0, COST)).toBe(false);
  });
});

describe('longestEncodableSeconds', () => {
  it('is the length whose estimate exactly fills the budget', () => {
    const shape = { frameRate: 30, inputPixels: FULL_HD, outputPixels: FULL_HD };
    const longest = longestEncodableSeconds(shape, VIDEO_TIME_BUDGET_MS, COST);

    const frames = Math.floor(longest * 30);
    expect(encodeFitsTimeBudget({ frames, ...shape }, VIDEO_TIME_BUDGET_MS, COST)).toBe(true);
    expect(encodeFitsTimeBudget({ frames: frames + 1, ...shape }, VIDEO_TIME_BUDGET_MS, COST)).toBe(false);
  });

  it('halves at twice the frame rate', () => {
    const thirty = longestEncodableSeconds({ frameRate: 30, inputPixels: FULL_HD, outputPixels: FULL_HD }, VIDEO_TIME_BUDGET_MS, COST);
    const sixty = longestEncodableSeconds({ frameRate: 60, inputPixels: FULL_HD, outputPixels: FULL_HD }, VIDEO_TIME_BUDGET_MS, COST);

    expect(sixty).toBeCloseTo(thirty / 2, 9);
  });
});

describe('the measured cost', () => {
  const longestAt = (inputPixels: number, outputPixels: number, frameRate = 30) =>
    longestEncodableSeconds({ frameRate, inputPixels, outputPixels }, VIDEO_TIME_BUDGET_MS, ENCODE_COST);

  // The failure behind #115: a guest's longest video at 1080p30 could not finish in time.
  it('refuses a 1080p30 video as long as the guest length cap', () => {
    expect(longestAt(FULL_HD, FULL_HD)).toBeLessThan(5 * 60);
  });

  it('allows a longer video when the same 1080p input is encoded at 480p', () => {
    expect(longestAt(FULL_HD, SD)).toBeGreaterThan(longestAt(FULL_HD, FULL_HD));
  });
});

describe('tooMuchWorkMessage', () => {
  it.each([
    [600, '720p', 'up to about 10 minutes long; choose 720p or a shorter clip.'],
    [179, '480p', 'up to about 2 minutes long; choose 480p or a shorter clip.'],
    [119, null, 'up to about 1 minute long; choose a shorter clip.'],
    [59, null, 'up to about 50 seconds long; choose a shorter clip.'],
    [12.7, null, 'up to about 12 seconds long; choose a shorter clip.'],
    [1.4, null, 'up to about 1 second long; choose a shorter clip.'],
    [0.2, '480p', 'up to about 1 second long; choose 480p or a shorter clip.'],
  ])('describes %s seconds with %s as the lower resolution', (seconds, lowerResolution, ending) => {
    const message = tooMuchWorkMessage(seconds, lowerResolution);

    expect(message).toBe(
      `This video would take too long to compress. Videos at this resolution and frame rate can be ${ending}`,
    );
  });
});
