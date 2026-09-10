export type Plan = 'Basic' | 'Pro' | 'Enterprise';

export interface PlanTierValues<T> {
  guest: T;
  Basic: T;
  Pro: T;
  Enterprise: T;
}

/**
 * Resolves a per-plan value (size cap, file count, page count, …) for the given plan.
 * An unknown, missing, or guest plan resolves to the `guest` tier. `Enterprise` must be
 * passed explicitly so it can never fall through to the guest tier — the bug this exists
 * to prevent (issue #31).
 */
export function resolvePlanLimit<T>(
  plan: string | null | undefined,
  tiers: PlanTierValues<T>,
): T {
  switch (plan) {
    case 'Enterprise':
      return tiers.Enterprise;
    case 'Pro':
      return tiers.Pro;
    case 'Basic':
      return tiers.Basic;
    default:
      return tiers.guest;
  }
}
