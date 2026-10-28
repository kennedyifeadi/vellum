import type { Plan } from '@/lib/plan-limits';
import { BYTES_PER_MB } from '@/lib/tool-limits';

// What a signed-in user may keep: their stored documents and conversion history together,
// and for how long. The quotas are small on purpose: every user's files share one bucket on
// R2's free tier (10 GB in all), and nothing is kept for more than a week.
// Guests store nothing, so there is no guest tier. An account whose plan is missing or
// unknown is on Basic, the account default.
// It imports nothing that runs on the server, so the client bundle can read it.

export interface StorageLimits {
  quotaBytes: number;
  retentionDays: number;
}

const MB = BYTES_PER_MB;
const GB = 1024 * MB;

export const STORAGE_LIMITS: Record<Plan, StorageLimits> = {
  Basic: { quotaBytes: 50 * MB, retentionDays: 3 },
  Pro: { quotaBytes: 100 * MB, retentionDays: 5 },
  Enterprise: { quotaBytes: 1 * GB, retentionDays: 7 },
};

export const PLANS: Plan[] = ['Basic', 'Pro', 'Enterprise'];

const DAY_MS = 24 * 60 * 60 * 1000;

function accountPlan(plan: string | null | undefined): Plan {
  return PLANS.find((p) => p === plan) ?? 'Basic';
}

export function storageLimits(plan: string | null | undefined): StorageLimits {
  return STORAGE_LIMITS[accountPlan(plan)];
}

/** When a file stored now on this plan is deleted. */
export function retentionExpiry(plan: string | null | undefined, now = Date.now()): Date {
  return new Date(now + storageLimits(plan).retentionDays * DAY_MS);
}

/** A quota as pricing shows it: "50 MB", "1 GB". */
export function formatQuota(bytes: number): string {
  return bytes >= GB ? `${bytes / GB} GB` : `${bytes / MB} MB`;
}

/** The plan with more storage than this one, or null on the largest. */
export function largerStoragePlan(plan: string | null | undefined): Plan | null {
  return PLANS[PLANS.indexOf(accountPlan(plan)) + 1] ?? null;
}

/** Why an upload was refused for lack of space: names the quota, and a larger plan if one exists. */
export function storageFullMessage(plan: string | null | undefined, fileName?: string): string {
  const current = accountPlan(plan);
  const what = fileName ? `Cannot upload "${fileName}".` : 'Cannot upload these files.';
  const larger = largerStoragePlan(current);
  const upgrade = larger ? ` Upgrade to ${larger} for more space.` : ' Delete some files to make room.';
  return `Storage limit reached. ${what} The ${current} plan stores up to ${formatQuota(STORAGE_LIMITS[current].quotaBytes)}.${upgrade}`;
}

export interface StorageNotice {
  type: 'error' | 'warning';
  title: 'Storage Full' | 'Storage Warning';
  message: string;
}

/** The dashboard's notice for this much use of the quota, or null below half full. */
export function storageNotice(usedBytes: number, limitBytes: number, plan: string | null | undefined): StorageNotice | null {
  const percent = (usedBytes / limitBytes) * 100;
  const current = accountPlan(plan);
  const quota = formatQuota(limitBytes);
  if (percent >= 100) {
    const larger = largerStoragePlan(current);
    return {
      type: 'error',
      title: 'Storage Full',
      message: `You have used all ${quota} of storage on the ${current} plan. Delete some files${larger ? ` or upgrade to ${larger}` : ''} to upload more.`,
    };
  }
  if (percent >= 50) {
    return {
      type: 'warning',
      title: 'Storage Warning',
      message: `Your storage is ${Math.round(percent)}% full. The ${current} plan stores up to ${quota}.`,
    };
  }
  return null;
}
