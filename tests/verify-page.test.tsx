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
const CODE = 'K7MP2WXZ';
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

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const entered = () => boxes().map((box) => box.value || '_').join('');
const focused = () => boxes().indexOf(document.activeElement as HTMLInputElement);
const verifyButton = () => screen.getByRole('button', { name: /Verify & Continue/ }) as HTMLButtonElement;

function paste(index: number, text: string) {
  fireEvent.paste(boxes()[index], { clipboardData: { getData: () => text } });
}

function type(index: number, value: string) {
  fireEvent.change(boxes()[index], { target: { value } });
}

function press(index: number, key: string, modifiers: { ctrlKey?: boolean } = {}) {
  boxes()[index].focus();
  fireEvent.keyDown(boxes()[index], { key, ...modifiers });
}

beforeEach(() => {
  render(<VerifyPage />);
});

describe('code boxes', () => {
  it('are eight labelled inputs in a labelled group, the first focused', () => {
    expect(screen.getByRole('group', { name: 'Verification code' })).toBeTruthy();
    const labelled = Array.from({ length: 8 }, (_, i) =>
      screen.getByRole('textbox', { name: `Character ${i + 1} of 8` }),
    );

    expect(boxes()).toEqual(labelled);
    expect(focused()).toBe(0);
  });

  it('offer one-time-code autofill', () => {
    for (const box of boxes()) expect(box.getAttribute('autocomplete')).toBe('one-time-code');
  });

  it('say the code has eight characters', () => {
    expect(document.body.textContent).toContain('8-character code');
    expect(document.body.textContent).not.toContain('6-digit');
  });
});

describe('paste', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('of a whole code into box %i fills every box', (index) => {
    paste(index, 'K7MP-2WXZ');

    expect(entered()).toBe(CODE);
    expect(focused()).toBe(7);
    expect(verifyButton().disabled).toBe(false);
  });

  it.each(['k7mp-2wxz', 'K7MP2WXZ', ' K7MP 2WXZ ', 'K 7 M P 2 W X Z', 'K7MP-2WXZ\r\n'])('reads %p', (text) => {
    paste(0, text);

    expect(entered()).toBe(CODE);
  });

  it('of a whole code replaces what was entered', () => {
    paste(0, '22222222');
    paste(5, CODE);

    expect(entered()).toBe(CODE);
  });

  it('of part of a code fills from that box', () => {
    paste(2, 'mp-2');

    expect(entered()).toBe('__MP2___');
    expect(focused()).toBe(5);
  });

  it('of part of a code stops at the last box', () => {
    paste(6, 'XZ22');

    expect(entered()).toBe('______XZ');
  });

  it.each(['', ' - ', 'K7MP-2WX0', 'K7MP-2WXZ2', 'your code'])('of %p changes nothing', (text) => {
    type(0, 'K');
    paste(1, text);

    expect(entered()).toBe('K_______');
  });
});

describe('typing', () => {
  it('upper-cases and moves to the next box', () => {
    type(0, 'k');

    expect(entered()).toBe('K_______');
    expect(focused()).toBe(1);
  });

  it('crosses from the first group to the second', () => {
    type(3, 'P');

    expect(focused()).toBe(4);
  });

  it('stays in the last box', () => {
    boxes()[7].focus();
    type(7, 'Z');

    expect(focused()).toBe(7);
  });

  it.each(['0', '1', 'i', 'L', 'o', '-', ' ', '!'])('ignores %p', (character) => {
    type(0, 'K');
    type(0, character);
    type(1, character);

    expect(entered()).toBe('K_______');
  });

  it.each([
    ['after', 'K7'],
    ['before', '7K'],
  ])('replaces a character when the new one is typed %s it', (_where, value) => {
    type(0, 'K');
    type(0, value);

    expect(entered()).toBe('7_______');
  });

  it('moves on when a box is given the character it holds', () => {
    type(0, 'K');
    press(0, 'k');

    expect(entered()).toBe('K_______');
    expect(focused()).toBe(1);
  });

  it('leaves shortcuts alone', () => {
    type(0, 'A');
    press(0, 'a', { ctrlKey: true });

    expect(focused()).toBe(0);
  });

  it('spreads an autofilled code over the boxes', () => {
    type(0, 'k7mp-2wxz');

    expect(entered()).toBe(CODE);
  });
});

describe('keyboard editing', () => {
  beforeEach(() => {
    paste(0, CODE);
  });

  it('Backspace clears the box it is in', () => {
    press(3, 'Backspace');

    expect(entered()).toBe('K7M_2WXZ');
    expect(focused()).toBe(3);
    expect(verifyButton().disabled).toBe(true);
  });

  it('Backspace in an empty box clears the one before it', () => {
    press(4, 'Backspace');
    press(4, 'Backspace');

    expect(entered()).toBe('K7M__WXZ');
    expect(focused()).toBe(3);
  });

  it('Backspace in an empty first box changes nothing more', () => {
    press(0, 'Backspace');
    press(0, 'Backspace');

    expect(entered()).toBe('_7MP2WXZ');
    expect(focused()).toBe(0);
  });

  it('Delete clears the box it is in', () => {
    press(5, 'Delete');

    expect(entered()).toBe('K7MP2_XZ');
    expect(focused()).toBe(5);
  });

  it('emptying a box clears it', () => {
    type(2, '');

    expect(entered()).toBe('K7_P2WXZ');
  });

  it.each([
    ['ArrowLeft', 4, 3],
    ['ArrowLeft', 0, 0],
    ['ArrowRight', 3, 4],
    ['ArrowRight', 7, 7],
    ['Home', 5, 0],
    ['End', 2, 7],
  ])('%s from box %i moves to box %i', (key, from, to) => {
    press(from, key);

    expect(focused()).toBe(to);
    expect(entered()).toBe(CODE);
  });
});

it('verifies the eight characters', async () => {
  answerWith(200, { isNewUser: false, user: { isProfileComplete: true } });
  paste(0, 'k7mp-2wxz');
  fireEvent.click(verifyButton());

  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/dashboard'), WAIT);
  const [url, init] = jest.mocked(global.fetch).mock.calls[0];
  expect(url).toBe('/api/auth/verify-otp');
  expect(JSON.parse(String(init?.body))).toEqual({ email: 'person@example.com', code: CODE });
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
