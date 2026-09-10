import { resolvePlanLimit } from '@/lib/plan-limits';

const tiers = { guest: 3, Basic: 30, Pro: 50, Enterprise: 250 };

describe('resolvePlanLimit', () => {
  it('returns the matching tier for each known plan', () => {
    expect(resolvePlanLimit('Basic', tiers)).toBe(30);
    expect(resolvePlanLimit('Pro', tiers)).toBe(50);
    expect(resolvePlanLimit('Enterprise', tiers)).toBe(250);
  });

  it('gives Enterprise its own tier rather than falling through to guest', () => {
    expect(resolvePlanLimit('Enterprise', tiers)).toBe(tiers.Enterprise);
    expect(resolvePlanLimit('Enterprise', tiers)).toBeGreaterThan(tiers.Pro);
  });

  it('falls back to the guest tier for an unknown, missing, or guest plan', () => {
    expect(resolvePlanLimit('Free', tiers)).toBe(3);
    expect(resolvePlanLimit(undefined, tiers)).toBe(3);
    expect(resolvePlanLimit(null, tiers)).toBe(3);
    expect(resolvePlanLimit('', tiers)).toBe(3);
  });

  it('works with non-numeric tier values', () => {
    const days = { guest: 3, Basic: 3, Pro: 5, Enterprise: 5 };
    expect(resolvePlanLimit('Enterprise', days)).toBe(5);
    expect(resolvePlanLimit('Basic', days)).toBe(3);
  });
});
