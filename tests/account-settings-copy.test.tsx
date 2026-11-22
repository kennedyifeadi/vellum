/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockShowToast = jest.fn();

jest.mock('@/app/dashboard/layout', () => ({
  useDashboard: () => ({ showToast: mockShowToast, user: { email: 'owner@example.com' } }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next-themes', () => {
  const setTheme = () => undefined;
  return { useTheme: () => ({ theme: 'light', setTheme }) };
});

import PreferencesTab from '../components/dashboard/PreferencesTab';
import SecurityTab from '../components/dashboard/SecurityTab';

jest.setTimeout(30_000);

beforeEach(() => {
  mockShowToast.mockReset();
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    json: async () => (url === '/api/user/sessions' ? [] : {}),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('says the account was deleted', async () => {
  window.confirm = () => true;
  render(<SecurityTab />);

  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));

  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Account deleted', 'success'), { timeout: 10_000 });
});

it('states what auto-delete still stores', async () => {
  render(<PreferencesTab />);

  const text = (await screen.findByText(/Don.t keep converted files/, {}, { timeout: 10_000 })).textContent;

  expect(text).not.toMatch(/never stored/);
  expect(text).toMatch(/Compress Video.*24 hours/);
  expect(text).toMatch(/My Documents.*until they expire/);
  expect(text).not.toMatch(/still lists it/);
});
