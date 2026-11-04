/** @jest-environment jsdom */
import React from 'react';
import { TextEncoder } from 'util';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BUSY_RETRY_POLICY } from '@/lib/busy-retry';

const mockShowToast = jest.fn();
const mockAddNotification = jest.fn();

jest.mock('@/app/dashboard/layout', () => ({
  useDashboard: () => ({
    showToast: mockShowToast,
    addNotification: mockAddNotification,
    user: { plan: 'Basic' },
  }),
}));

jest.mock('next/script', () => ({ __esModule: true, default: () => null }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

import SideDrawer from '../components/dashboard/SideDrawer';

jest.setTimeout(30_000);

// Browsers have TextEncoder; jsdom's test environment does not, and the Lock PDF check needs it.
globalThis.TextEncoder ??= TextEncoder as typeof globalThis.TextEncoder;

const MOBILE_QUERY = '(max-width: 767px)';

type FakeAnswer = {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
};

function answer({ status = 200, headers = {}, json }: FakeAnswer = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => json ?? {},
    blob: async () => new Blob(['result']),
  };
}

let fetchMock: jest.Mock;

function useLayout(layout: 'mobile' | 'desktop') {
  window.matchMedia = jest.fn((query: string) => ({
    matches: layout === 'mobile' && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

function pdf(name = 'report.pdf') {
  return new File(['%PDF-1.7 test'], name, { type: 'application/pdf' });
}

function renderDrawer(toolId: string) {
  return render(<SideDrawer isOpen onClose={jest.fn()} file={null} toolId={toolId} />);
}

function fileInput(container: HTMLElement) {
  const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input rendered');
  return input;
}

function chooseFiles(container: HTMLElement, files: File[]) {
  fireEvent.change(fileInput(container), { target: { files } });
}

function processButton() {
  return screen.getByRole('button', { name: /Process File|Processing|Waiting for a free slot/ });
}

function toolRequests() {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/convert/'));
}

function sentForm(index = 0) {
  return toolRequests()[index][1].body as FormData;
}

beforeEach(() => {
  mockShowToast.mockReset();
  mockAddNotification.mockReset();
  fetchMock = jest.fn(async () => answer());
  global.fetch = fetchMock as unknown as typeof fetch;
  URL.createObjectURL = jest.fn(() => 'blob:result');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('SideDrawer at mobile width', () => {
  beforeEach(() => useLayout('mobile'));

  it('opens the file dialog from the Upload File tile', () => {
    const { container } = renderDrawer('compress-pdf');
    const clicked = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByText('Upload File'));

    expect(clicked).toHaveBeenCalledTimes(1);
    expect(clicked.mock.contexts[0]).toBe(fileInput(container));
  });

  it('lists a chosen file and sends it once to the tool route', async () => {
    const { container } = renderDrawer('compress-pdf');
    const file = pdf();

    chooseFiles(container, [file]);
    expect(screen.getByText('report.pdf')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'high' }));
    fireEvent.click(processButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'success'));
    expect(toolRequests()).toHaveLength(1);
    expect(toolRequests()[0][0]).toBe('/api/convert/compress-pdf');
    expect(sentForm().getAll('pdf')).toEqual([file]);
    expect(sentForm().get('level')).toBe('high');
  });

  it('shows the Lock PDF password fields and enables Process only for a valid, confirmed password', async () => {
    const { container } = renderDrawer('lock-pdf');
    chooseFiles(container, [pdf()]);
    const password = screen.getByPlaceholderText(/At least \d+ characters/);
    const confirm = screen.getByPlaceholderText('Repeat password');

    expect((processButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(password, { target: { value: 'short' } });
    fireEvent.change(confirm, { target: { value: 'short' } });
    expect((processButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(password, { target: { value: 'long enough secret' } });
    expect((processButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(confirm, { target: { value: 'long enough secret' } });
    expect((processButton() as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(processButton());
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('PDF locked successfully!', 'success'));
    expect(toolRequests()).toHaveLength(1);
    expect(toolRequests()[0][0]).toBe('/api/convert/lock-pdf');
    expect(sentForm().get('password')).toBe('long enough secret');
  });

  it('sends the Split PDF page range', async () => {
    const { container } = renderDrawer('split-pdf');
    chooseFiles(container, [pdf()]);
    const [start, end] = screen.getAllByRole('spinbutton');

    fireEvent.change(end, { target: { value: '4' } });
    fireEvent.change(start, { target: { value: '2' } });
    fireEvent.click(processButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('PDF split successfully!', 'success'));
    expect(toolRequests()).toHaveLength(1);
    expect(toolRequests()[0][0]).toBe('/api/convert/split-pdf');
    expect(sentForm().get('startPage')).toBe('2');
    expect(sentForm().get('endPage')).toBe('4');
    expect(sentForm().get('splitEvery')).toBe('false');
  });

  it('waits for a free slot when the tool is busy, and Cancel stops waiting and keeps the file', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(async () => answer({ status: 503, headers: { 'Retry-After': '30' } }));
    const { container } = renderDrawer('compress-pdf');
    chooseFiles(container, [pdf()]);

    fireEvent.click(processButton());

    expect(await screen.findByText('Waiting for a free slot…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Waiting for a free slot…')).toBeNull());
    await act(async () => {
      jest.advanceTimersByTime(BUSY_RETRY_POLICY.maxTotalWaitMs);
    });
    expect(toolRequests()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByText('report.pdf')).toBeTruthy();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('shows the Find in PDF matches', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/convert/find-pdf'
        ? answer({
            json: {
              matchCount: 2,
              matches: [
                { page: 3, text: 'invoice', snippet: 'the invoice total' },
                { page: 7, text: 'invoice', snippet: 'a second invoice' },
              ],
              pdfBase64: 'JVBERi0=',
            },
          })
        : answer(),
    );
    const { container } = renderDrawer('find-pdf');
    chooseFiles(container, [pdf()]);
    fireEvent.change(screen.getByPlaceholderText('Word or phrase to find...'), { target: { value: 'invoice' } });

    fireEvent.click(processButton());

    expect(await screen.findByText('Search Results (2)')).toBeTruthy();
    expect(screen.getByText('Page 3')).toBeTruthy();
    expect(screen.getByText('the invoice total')).toBeTruthy();
    expect(screen.getByText('a second invoice')).toBeTruthy();
    expect(toolRequests()).toHaveLength(1);
    expect(sentForm().get('searchTerm')).toBe('invoice');
  });
});

describe('SideDrawer at desktop width', () => {
  beforeEach(() => useLayout('desktop'));

  it('sends a chosen file once to a generic tool route', async () => {
    const { container } = renderDrawer('compress-pdf');
    const clicked = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByText('Upload File'));
    expect(clicked.mock.contexts[0]).toBe(fileInput(container));
    clicked.mockRestore();

    const file = pdf();
    chooseFiles(container, [file]);
    expect(screen.getByText('report.pdf')).toBeTruthy();
    fireEvent.click(processButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'success'));
    expect(toolRequests()).toHaveLength(1);
    expect(toolRequests()[0][0]).toBe('/api/convert/compress-pdf');
    expect(sentForm().getAll('pdf')).toEqual([file]);
    expect(sentForm().get('level')).toBe('medium');
  });

  it('enables Lock PDF only for a valid, confirmed password and sends it', async () => {
    const { container } = renderDrawer('lock-pdf');
    chooseFiles(container, [pdf()]);
    const password = screen.getByPlaceholderText(/At least \d+ characters/);
    const confirm = screen.getByPlaceholderText('Repeat password');

    fireEvent.change(password, { target: { value: 'short' } });
    fireEvent.change(confirm, { target: { value: 'short' } });
    expect((processButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(password, { target: { value: 'long enough secret' } });
    fireEvent.change(confirm, { target: { value: 'long enough secret' } });
    expect((processButton() as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(processButton());
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('PDF locked successfully!', 'success'));
    expect(toolRequests()).toHaveLength(1);
    expect(toolRequests()[0][0]).toBe('/api/convert/lock-pdf');
    expect(sentForm().get('password')).toBe('long enough secret');
  });
});
