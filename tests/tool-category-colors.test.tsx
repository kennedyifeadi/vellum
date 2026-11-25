/** @jest-environment jsdom */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ALL_TOOLS, TOOL_CATEGORY_COLORS } from '@/lib/tools';
import ToolIcon from '@/components/shared/ToolIcon';

afterEach(cleanup);

const EXPECTED_CATEGORIES = {
  pdf: ['merge-pdf', 'split-pdf', 'compress-pdf', 'lock-pdf', 'find-pdf'],
  image: ['image-to-pdf', 'jpg-to-png', 'image-compress'],
  video: ['video-compress'],
  doc: ['docx-to-pdf', 'html-to-pdf', 'pdf-to-docx'],
};

describe('tool category colours', () => {
  it('puts each tool in the same category as the nav menu does', () => {
    for (const [category, ids] of Object.entries(EXPECTED_CATEGORIES)) {
      const actual = ALL_TOOLS.filter((tool) => tool.category === category).map((tool) => tool.id);
      expect(actual.sort()).toEqual([...ids].sort());
    }
  });

  it('gives every category one icon colour on its own tint', () => {
    expect(TOOL_CATEGORY_COLORS).toEqual({
      pdf: { well: 'bg-cat-pdf-tint', icon: 'text-cat-pdf' },
      image: { well: 'bg-cat-image-tint', icon: 'text-cat-image' },
      video: { well: 'bg-cat-video-tint', icon: 'text-cat-video' },
      doc: { well: 'bg-cat-doc-tint', icon: 'text-cat-doc' },
    });
  });

  it.each([
    ['Merge PDF', 'bg-cat-pdf-tint', 'text-cat-pdf'],
    ['Image to PDF', 'bg-cat-image-tint', 'text-cat-image'],
    ['Compress Video', 'bg-cat-video-tint', 'text-cat-video'],
    ['DOCX to PDF', 'bg-cat-doc-tint', 'text-cat-doc'],
  ])('draws the %s icon in its category colours', (toolName, well, icon) => {
    const { container } = render(<ToolIcon toolName={toolName} />);
    const classes = (container.firstElementChild as HTMLElement).classList;
    expect(classes).toContain(well);
    expect(classes).toContain(icon);
  });

  it('draws a neutral icon for a tool name it does not know', () => {
    const { container } = render(<ToolIcon toolName="Unknown Tool" />);
    const classes = (container.firstElementChild as HTMLElement).classList;
    expect(classes).toContain('bg-surface-sunken');
    expect(classes).toContain('text-ink-muted');
  });
});
