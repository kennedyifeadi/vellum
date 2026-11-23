/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRouter = { push: jest.fn() };
const mockSearchParams = new URLSearchParams({ email: 'person@example.com' });

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));

import VerifyPage from '../app/(auth)/verify/page';

jest.setTimeout(30_000);

const WAIT = { timeout: 10_000 };
const REFUSED = 'Too many codes requested. Please try again later.';

const originalFetch = global.fetch;
let alerted: jest.Mock;

beforeEach(() => {
  alerted = jest.fn();
  window.alert = alerted;
  mockRouter.push.mockReset();
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function answerWith(status: number, body: object) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

beforeEach(() => {
  render(<VerifyPage />);
});

describe('resend', () => {
  const resend = () => fireEvent.click(screen.getByRole('button', { name: 'Click to resend' }));

  it.each([
    [429, REFUSED],
    [429, 'Too many requests. Please try again later.'],
    [503, 'Email sign-in is temporarily unavailable.'],
  ])("shows the server's %i reason %p", async (status, error) => {
    answerWith(status, { error });
    resend();

    await waitFor(() => expect(alerted).toHaveBeenCalledWith(error), WAIT);
  });

  it('falls back when the refusal gives no reason', async () => {
    answerWith(500, {});
    resend();

    await waitFor(() => expect(alerted).toHaveBeenCalledWith('Failed to resend code.'), WAIT);
  });

  it('says so when the answer cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    resend();

    await waitFor(() => expect(alerted).toHaveBeenCalledWith('An unexpected error occurred.'), WAIT);
  });

  it('confirms a code sent again', async () => {
    answerWith(200, {});
    resend();

    await waitFor(() => expect(alerted).toHaveBeenCalledWith('Verification code resent!'), WAIT);
  });
});
