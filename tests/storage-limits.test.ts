import { PlanTierValues } from '@/lib/plan-limits';
import {
  PLANS,
  STORAGE_LIMITS,
  formatQuota,
  largerStoragePlan,
  storageFullMessage,
  storageLimits,
  storageNotice,
} from '@/lib/storage-limits';
import { TOOL_IDS, TOOL_LIMITS, ToolLimits } from '@/lib/tool-limits';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('STORAGE_LIMITS', () => {
  it('holds each plan\'s quota and retention', () => {
    expect(STORAGE_LIMITS).toEqual({
      Basic: { quotaBytes: 50 * MB, retentionDays: 3 },
      Pro: { quotaBytes: 100 * MB, retentionDays: 5 },
      Enterprise: { quotaBytes: GB, retentionDays: 7 },
    });
  });

  it.each([
    [undefined],
    [null],
    ['Platinum'],
  ])('puts an account with plan %p on Basic', (plan) => {
    expect(storageLimits(plan)).toEqual(STORAGE_LIMITS.Basic);
  });
});

describe('Basic <= Pro <= Enterprise', () => {
  function ordered(values: number[]) {
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  }

  const tierCaps = (limits: ToolLimits): PlanTierValues<number>[] =>
    [limits.maxBytes, limits.maxFiles, limits.maxPages, limits.maxLines, limits.maxVideoMinutes].filter(
      (caps): caps is PlanTierValues<number> => caps !== undefined,
    );

  it.each(TOOL_IDS)('for every %s limit, guest included', (tool) => {
    for (const caps of tierCaps(TOOL_LIMITS[tool])) {
      ordered([caps.guest, caps.Basic, caps.Pro, caps.Enterprise]);
    }
  });

  it('for the storage quota and retention', () => {
    ordered(PLANS.map((plan) => STORAGE_LIMITS[plan].quotaBytes));
    ordered(PLANS.map((plan) => STORAGE_LIMITS[plan].retentionDays));
  });
});

describe('formatQuota', () => {
  it.each([
    [50 * MB, '50 MB'],
    [100 * MB, '100 MB'],
    [GB, '1 GB'],
  ])('%i bytes is %s', (bytes, label) => {
    expect(formatQuota(bytes)).toBe(label);
  });
});

describe('storageFullMessage', () => {
  it('names the quota and the next plan up', () => {
    expect(storageFullMessage('Basic', 'a.pdf')).toBe(
      'Storage limit reached. Cannot upload "a.pdf". The Basic plan stores up to 50 MB. Upgrade to Pro for more space.',
    );
    expect(storageFullMessage('Pro')).toBe(
      'Storage limit reached. Cannot upload these files. The Pro plan stores up to 100 MB. Upgrade to Enterprise for more space.',
    );
  });

  it('suggests no upgrade on the largest plan', () => {
    expect(largerStoragePlan('Enterprise')).toBeNull();
    expect(storageFullMessage('Enterprise', 'a.pdf')).toBe(
      'Storage limit reached. Cannot upload "a.pdf". The Enterprise plan stores up to 1 GB. Delete some files to make room.',
    );
  });
});

describe('storageNotice', () => {
  it('says nothing below half full', () => {
    expect(storageNotice(25 * MB - 1, 50 * MB, 'Basic')).toBeNull();
  });

  it('warns from half full, naming the quota', () => {
    expect(storageNotice(25 * MB, 50 * MB, 'Basic')).toEqual({
      type: 'warning',
      title: 'Storage Warning',
      message: 'Your storage is 50% full. The Basic plan stores up to 50 MB.',
    });
  });

  it('reports full at the quota, suggesting an upgrade only when one exists', () => {
    expect(storageNotice(100 * MB, 100 * MB, 'Pro')?.message).toBe(
      'You have used all 100 MB of storage on the Pro plan. Delete some files or upgrade to Enterprise to upload more.',
    );
    expect(storageNotice(GB, GB, 'Enterprise')?.message).toBe(
      'You have used all 1 GB of storage on the Enterprise plan. Delete some files to upload more.',
    );
  });
});
