import { ClientError } from '../lib/convert/errors';
import { assertFileSizeWithinPlan, encodeLimitsForPlan, VIDEO_TIME_BUDGET_MS } from '../lib/convert/video-compress-limits';

const MB = 1024 * 1024;
const PLANS = ['Free', 'Basic', 'Pro', 'Enterprise'];

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
