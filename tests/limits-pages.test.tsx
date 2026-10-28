import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TOOL_IDS } from '@/lib/tool-limits';
import { LIMITS_VARY_NOTE, PLAN_TIERS, headlineFeatures, toolLimitSummary } from '@/lib/upload-limits';

jest.mock('@/app/dashboard/layout', () => ({
  useDashboard: () => ({ showToast: jest.fn() }),
}));

// The carousel animates with GSAP and plays no part in the limits.
jest.mock('@/components/marketing/ToolsCarousel', () => ({
  __esModule: true,
  default: () => null,
}));

import ToolLimitsTable from '../components/dashboard/ToolLimitsTable';
import HelpPage from '../app/dashboard/help/page';
import PricingPage from '../app/(marketing)/pricing/page';
import PricingCompareTable from '../components/marketing/PricingCompareTable';

function cells(markup: string): string[] {
  return [...markup.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((match) => match[1]);
}

describe('toolLimitSummary', () => {
  it.each([
    ['pdf-to-docx', 'guest', '5 MB, 100 pages, 8,000 lines of text'],
    ['pdf-to-docx', 'Enterprise', '25 MB, 500 pages, 40,000 lines of text'],
    ['find-pdf', 'Basic', '50 MB, 50 pages'],
    ['merge-pdf', 'Enterprise', '250 MB in total, 100 files'],
    ['image-compress', 'Enterprise', '200 MB in total, 100 files, 50 megapixels per image'],
    ['compress-pdf', 'Enterprise', '200 MB'],
    ['image-compress', 'guest', '25 MB in total, 3 files, 50 megapixels per image'],
    ['video-compress', 'Pro', '500 MB, up to 30 minutes'],
  ] as const)('%s on %s', (tool, tier, summary) => {
    expect(toolLimitSummary(tool, tier)).toBe(summary);
  });
});

describe('ToolLimitsTable', () => {
  it("renders every tool's limits on every plan from the shared module", () => {
    const markup = renderToStaticMarkup(<ToolLimitsTable />);

    const expected = TOOL_IDS.flatMap((tool) => PLAN_TIERS.map((tier) => toolLimitSummary(tool, tier)));
    expect(cells(markup).filter((cell) => !/^[A-Z]/.test(cell))).toEqual(expected);
    expect(markup).toContain('PDF to DOCX');
    expect(markup).toContain('depends on its resolution and frame rate');
  });
});

describe('HelpPage', () => {
  it('shows the limits table and a maximum file size answer that matches it', () => {
    const markup = renderToStaticMarkup(<HelpPage />);

    expect(markup).toContain('Upload limits by tool');
    expect(markup).toContain(toolLimitSummary('pdf-to-docx', 'guest'));
    expect(markup).not.toContain('Free tier users can upload files up to 50MB');
  });
});

describe('pricing', () => {
  it.each(PLAN_TIERS)('the %s card lists the shared headline limits', (tier) => {
    const markup = renderToStaticMarkup(<PricingPage />);

    for (const feature of headlineFeatures(tier)) {
      expect(markup).toContain(feature);
    }
  });

  it('shows Enterprise its real values and points to Help', () => {
    const markup = renderToStaticMarkup(<PricingPage />);

    expect(markup).toContain('200MB Max File Size (500MB Video)');
    expect(markup).toContain('100 Files per Batch Conversion');
    expect(markup).not.toContain('Custom Max File Sizes');
    expect(markup).toContain(LIMITS_VARY_NOTE);
    expect(markup).toContain('href="/dashboard/help"');
  });

  it('the compare table rows come from the same values', () => {
    const markup = renderToStaticMarkup(<PricingCompareTable />);

    for (const row of ['25MB', '50MB', '100MB', '200MB', '500MB', '3 files', '100 files', '10 pages', '500 pages']) {
      expect(markup).toContain(`>${row}<`);
    }
    expect(markup).not.toContain('250 files');
    expect(markup).not.toContain('Unlimited');
    expect(markup).toContain(LIMITS_VARY_NOTE);
  });

});
