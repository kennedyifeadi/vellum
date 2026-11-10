/** @jest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} data-next-link="true" {...props}>
      {children}
    </a>
  ),
}));

jest.mock('@/app/dashboard/layout', () => ({
  useDashboard: () => ({
    unreadCount: 2,
    markAllAsRead: jest.fn(),
    notifications: [
      {
        id: 'video',
        type: 'success',
        title: 'Video compressed',
        message: '"clip.mp4" is ready.',
        timestamp: new Date().toISOString(),
        isRead: false,
        link: '/api/convert/video-compress/jobs/6730a1b2c3d4e5f6a7b8c9d0/download',
      },
      {
        id: 'page',
        type: 'success',
        title: 'Conversion Complete',
        message: 'Your file is ready.',
        timestamp: new Date().toISOString(),
        isRead: false,
        link: '/dashboard/recent',
      },
    ],
  }),
}));

import NotificationDropdown from '../components/dashboard/NotificationDropdown';

afterEach(cleanup);

describe('notification links', () => {
  it('opens a download as a plain link, so it is neither prefetched nor fetched twice', () => {
    render(<NotificationDropdown isOpen onClose={jest.fn()} />);

    const download = screen.getByText('Video compressed').closest('a')!;
    expect(download.getAttribute('href')).toBe('/api/convert/video-compress/jobs/6730a1b2c3d4e5f6a7b8c9d0/download');
    expect(download.hasAttribute('data-next-link')).toBe(false);
  });

  it('still opens a page through Next', () => {
    render(<NotificationDropdown isOpen onClose={jest.fn()} />);

    const page = screen.getByText('Conversion Complete').closest('a')!;
    expect(page.getAttribute('href')).toBe('/dashboard/recent');
    expect(page.getAttribute('data-next-link')).toBe('true');
  });
});
