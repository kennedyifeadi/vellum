/** @jest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockShowToast = jest.fn();

jest.mock('@/app/dashboard/layout', () => ({ useDashboard: () => ({ showToast: mockShowToast }) }));
jest.mock('@/components/dashboard/ToolLimitsTable', () => ({ __esModule: true, default: () => null }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));

import ContactFormSection from '../components/marketing/ContactFormSection';
import HelpPage from '../app/dashboard/help/page';

jest.setTimeout(30_000);

const WAIT = { timeout: 10_000 };
const UNDELIVERED = 'Your message could not be delivered. Please try again later.';
const HELP_MESSAGE_PLACEHOLDER = "Tell us more about what's going on...";

function answerWith(status: number, body: object) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

function fillAndSend(fields: Record<string, string>, button: string) {
  for (const [placeholder, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: button }));
}

function sendContactForm() {
  render(<ContactFormSection />);
  fillAndSend(
    { 'Full name': 'Grace', Email: 'grace@guest.test', Subject: 'Merge', Message: 'It is stuck.' },
    'Send a message',
  );
}

function sendHelpForm() {
  render(<HelpPage />);
  fillAndSend({ 'Brief summary of your issue': 'Merge', [HELP_MESSAGE_PLACEHOLDER]: 'It is stuck.' }, 'Send Message');
}

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  mockShowToast.mockReset();
  global.fetch = originalFetch;
});

it('the contact form shows a failed delivery and keeps the message', async () => {
  answerWith(502, { error: UNDELIVERED });
  sendContactForm();

  await screen.findByText(UNDELIVERED, undefined, WAIT);
  expect(screen.queryByText('Message Sent!')).toBeNull();
  expect((screen.getByPlaceholderText('Message') as HTMLTextAreaElement).value).toBe('It is stuck.');
});

it('the contact form shows success', async () => {
  answerWith(201, { success: true });
  sendContactForm();

  await screen.findByText('Message Sent!', undefined, WAIT);
});

it('the help form shows a failed delivery and keeps the message', async () => {
  answerWith(502, { error: UNDELIVERED });
  sendHelpForm();

  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(UNDELIVERED, 'error'), WAIT);
  expect((screen.getByPlaceholderText(HELP_MESSAGE_PLACEHOLDER) as HTMLTextAreaElement).value).toBe('It is stuck.');
});

it('the help form shows success', async () => {
  answerWith(201, { success: true });
  sendHelpForm();

  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'success'), WAIT);
});
