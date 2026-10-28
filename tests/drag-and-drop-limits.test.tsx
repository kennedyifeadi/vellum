import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let mockUser: { plan?: string } | null = null;

jest.mock('@/app/dashboard/layout', () => ({
  useDashboard: () => ({ openDrawer: jest.fn(), showToast: jest.fn(), user: mockUser }),
}));

import DragAndDrop from '../components/dashboard/DragAndDrop';

describe('DragAndDrop', () => {
  it.each([
    [null, 'Max file size 25 MB on the Free plan'],
    [{ plan: 'Basic' }, 'Max file size 50 MB on the Basic plan'],
    [{ plan: 'Enterprise' }, 'Max file size 200 MB on the Enterprise plan'],
  ])('shows the cap for %p', (user, label) => {
    mockUser = user;

    const markup = renderToStaticMarkup(<DragAndDrop />);

    expect(markup).toContain(label);
    expect(markup).not.toContain('50MB');
  });
});
