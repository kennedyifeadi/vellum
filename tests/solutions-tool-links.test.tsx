/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ALL_TOOLS } from '@/lib/tools';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import Navbar from '@/components/shared/Navbar';
import Footer from '@/components/shared/Footer';

// The footer reveals itself on scroll; jsdom has no IntersectionObserver.
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;

afterEach(cleanup);

const EVERY_TOOL_PAGE = ALL_TOOLS.map((tool) => `/solutions/${tool.id}`).sort();

describe('tool links', () => {
  it("send the nav bar's tools to their Solutions pages", () => {
    render(<Navbar />);
    fireEvent.click(screen.getAllByRole('button', { name: /Solutions/ })[0]);

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => href.startsWith('/solutions/')).sort()).toEqual(EVERY_TOOL_PAGE);
    expect(hrefs.filter((href) => href.includes('?tool='))).toEqual([]);
  });

  it("send the footer's tools to their Solutions pages", () => {
    render(<Footer />);

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => href.startsWith('/solutions/')).sort()).toEqual(EVERY_TOOL_PAGE);
    expect(hrefs.filter((href) => href.includes('?tool='))).toEqual([]);
  });
});
