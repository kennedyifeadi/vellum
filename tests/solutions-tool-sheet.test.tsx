/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ALL_TOOLS } from '@/lib/tools';

jest.mock('next/script', () => ({ __esModule: true, default: () => null }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));
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
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  },
}));

import SolutionsToolHost from '@/components/marketing/SolutionsToolHost';
import SolutionsTools from '@/components/marketing/SolutionsTools';
import SideDrawer from '@/components/dashboard/SideDrawer';
import { ToolHostProvider } from '@/components/shared/ToolHost';
import * as toolPage from '@/app/(marketing)/solutions/[tool]/page';

jest.setTimeout(30_000);
// The sheet leaves the page only once its exit animation ends.
configure({ asyncUtilTimeout: 10_000 });

// jsdom has no PointerEvent, and the Event it falls back to drops clientY.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}
(window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent ??= TestPointerEvent;

type FakeAnswer = { status?: number; json?: unknown; headers?: Record<string, string> };

function answer({ status = 200, json, headers = {} }: FakeAnswer = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => json ?? {},
    blob: async () => new Blob(['result']),
  };
}

let fetchMock: jest.Mock;
let signedInUser: { plan: string } | null;
let convertAnswer: () => Promise<ReturnType<typeof answer>>;

function pdf(name: string) {
  return new File(['%PDF-1.7 test'], name, { type: 'application/pdf' });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function at(path: string) {
  window.history.replaceState(null, '', path);
}

function renderSolutions(initialTool: string | null) {
  return render(
    <>
      <button>Before the list</button>
      <SolutionsToolHost>
        <SolutionsTools initialTool={initialTool} />
      </SolutionsToolHost>
    </>,
  );
}

function sheet() {
  return screen.queryByRole('dialog');
}

function chooseFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input rendered');
  fireEvent.change(input, { target: { files } });
}

function processButton() {
  return screen.getByRole('button', { name: /Process File|Processing|Waiting for a free slot/ });
}

function closeButton() {
  return screen.queryByRole('button', { name: 'Close' });
}

function dragHandle() {
  return screen.getByTestId('sheet-drag-handle');
}

function dragDown(by: number) {
  fireEvent.pointerDown(dragHandle(), { clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(window, { clientY: 300 + by, pointerId: 1 });
  fireEvent.pointerUp(window, { clientY: 300 + by, pointerId: 1 });
}

function requests(path: string, method = 'GET') {
  return fetchMock.mock.calls.filter(([url, init]) => url === path && (init?.method ?? 'GET') === method);
}

async function sessionChecked() {
  await waitFor(() => expect(requests('/api/auth/me')).toHaveLength(1));
}

async function startMergeThatHangs() {
  const pending = deferred<ReturnType<typeof answer>>();
  convertAnswer = () => pending.promise;
  chooseFiles([pdf('a.pdf'), pdf('b.pdf')]);
  fireEvent.click(processButton());
  expect(await screen.findByText('Processing...')).toBeTruthy();
  return pending;
}

async function finishWithError(pending: ReturnType<typeof deferred<ReturnType<typeof answer>>>) {
  await act(async () => {
    pending.resolve(answer({ status: 500, json: { error: 'Merge failed on the server.' } }));
  });
  expect(await screen.findByText('Merge failed on the server.')).toBeTruthy();
  await waitFor(() => expect(screen.queryByText('Processing...')).toBeNull());
}

beforeEach(() => {
  at('/solutions');
  signedInUser = null;
  convertAnswer = async () => answer();
  fetchMock = jest.fn(async (url: string) => {
    if (url === '/api/auth/me') {
      return signedInUser ? answer({ json: { user: signedInUser } }) : answer({ status: 401, json: { error: 'Unauthorized' } });
    }
    if (url === '/api/user/notifications') return answer({ json: { success: true } });
    if (String(url).startsWith('/api/convert/')) return convertAnswer();
    return answer({ status: 404 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  URL.createObjectURL = jest.fn(() => 'blob:result');
  URL.revokeObjectURL = jest.fn();
  window.matchMedia = jest.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe('a guest on /solutions/merge-pdf', () => {
  it('finds the sheet open, merges two PDFs and downloads the result, with no notification', async () => {
    at('/solutions/merge-pdf');
    const saved: string[] = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    renderSolutions('merge-pdf');
    await sessionChecked();

    expect(sheet()).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Merge PDF' })).toBeTruthy();

    const first = pdf('a.pdf');
    const second = pdf('b.pdf');
    chooseFiles([first, second]);
    fireEvent.click(processButton());

    expect(await screen.findByText('Merge PDF processed successfully!')).toBeTruthy();
    const sent = requests('/api/convert/merge-pdf', 'POST');
    expect(sent).toHaveLength(1);
    expect((sent[0][1].body as FormData).getAll('pdfs')).toEqual([first, second]);
    expect(saved).toEqual(['processed_a.pdf']);
    expect(requests('/api/user/notifications', 'POST')).toHaveLength(0);
    await waitFor(() => expect(sheet()).toBeNull());
    expect(window.location.pathname).toBe('/solutions');
  });

  it("shows the guest's own limit for the tool", async () => {
    at('/solutions/merge-pdf');
    renderSolutions('merge-pdf');
    await sessionChecked();

    const { uploadLimitLabel } = await import('@/lib/upload-limits');
    expect(screen.getByText(uploadLimitLabel('merge-pdf', null))).toBeTruthy();
  });
});

describe('a signed-in user on Solutions', () => {
  it('gets a notification for a finished conversion', async () => {
    signedInUser = { plan: 'Basic' };
    at('/solutions/merge-pdf');
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderSolutions('merge-pdf');
    await sessionChecked();
    const { uploadLimitLabel } = await import('@/lib/upload-limits');
    await waitFor(() => expect(screen.getByText(uploadLimitLabel('merge-pdf', 'Basic'))).toBeTruthy());

    chooseFiles([pdf('a.pdf'), pdf('b.pdf')]);
    fireEvent.click(processButton());

    await waitFor(() => expect(requests('/api/user/notifications', 'POST')).toHaveLength(1));
    const body = JSON.parse(requests('/api/user/notifications', 'POST')[0][1].body as string);
    expect(body).toMatchObject({ type: 'success', title: 'Conversion Complete' });
  });
});

describe('a signed-in user whose session check is still pending', () => {
  it('still gets the notification when the conversion ends after the check', async () => {
    signedInUser = { plan: 'Basic' };
    at('/solutions/merge-pdf');
    const session = deferred<ReturnType<typeof answer>>();
    const merged = deferred<ReturnType<typeof answer>>();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/me') return session.promise;
      if (url === '/api/user/notifications') return answer({ json: { success: true } });
      return merged.promise;
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderSolutions('merge-pdf');
    chooseFiles([pdf('a.pdf'), pdf('b.pdf')]);
    fireEvent.click(processButton());
    expect(await screen.findByText('Processing...')).toBeTruthy();

    await act(async () => session.resolve(answer({ json: { user: signedInUser } })));
    await act(async () => merged.resolve(answer()));

    await waitFor(() => expect(requests('/api/user/notifications', 'POST')).toHaveLength(1));
  });
});

describe('closing the sheet', () => {
  beforeEach(() => at('/solutions/merge-pdf'));

  it.each([
    ['the close button', () => fireEvent.click(closeButton()!)],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['dragging it down', () => dragDown(200)],
  ])('works with %s before processing', async (_, close) => {
    renderSolutions('merge-pdf');
    await sessionChecked();

    close();

    await waitFor(() => expect(sheet()).toBeNull());
  });

  it('is blocked while a file is processing, by button, Escape, drag or backdrop', async () => {
    renderSolutions('merge-pdf');
    await sessionChecked();
    await startMergeThatHangs();

    expect(closeButton()).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    dragDown(200);
    fireEvent.click(screen.getByTestId('sheet-backdrop'));

    expect(sheet()).toBeTruthy();
    expect(window.location.pathname).toBe('/solutions/merge-pdf');
  });

  it.each([
    ['the close button', () => fireEvent.click(closeButton()!)],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['dragging it down', () => dragDown(200)],
  ])('works again with %s once processing has ended', async (_, close) => {
    renderSolutions('merge-pdf');
    await sessionChecked();
    const pending = await startMergeThatHangs();
    await finishWithError(pending);

    close();

    await waitFor(() => expect(sheet()).toBeNull());
  });

  it('keeps Cancel while waiting for a free slot', async () => {
    convertAnswer = async () => answer({ status: 503, headers: { 'Retry-After': '30' } });
    renderSolutions('merge-pdf');
    await sessionChecked();
    chooseFiles([pdf('a.pdf'), pdf('b.pdf')]);
    fireEvent.click(processButton());

    expect(await screen.findByText('Waiting for a free slot…')).toBeTruthy();
    expect(closeButton()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(closeButton()).toBeTruthy());
  });

  it('expands to full height when dragged up and goes back to half when dragged down from full', async () => {
    renderSolutions('merge-pdf');
    await sessionChecked();
    const dialog = sheet()!;
    expect(dialog.dataset.size).toBe('half');

    dragDown(-120);
    await waitFor(() => expect(dialog.dataset.size).toBe('full'));
    dragDown(200);

    await waitFor(() => expect(dialog.dataset.size).toBe('half'));
    expect(sheet()).toBeTruthy();
  });
});

describe('a Compress Video job in the sheet', () => {
  async function startVideoJob() {
    at('/solutions/video-compress');
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/me') {
        return signedInUser ? answer({ json: { user: signedInUser } }) : answer({ status: 401 });
      }
      if (url === '/api/convert/video-compress') {
        return answer({ status: 202, json: { jobId: 'job-1', status: 'queued', ...(signedInUser ? {} : { token: 'guest-token' }) } });
      }
      return answer({ json: { status: 'queued', position: 1, fileName: 'clip.mp4', originalSize: 1 } });
    });
    renderSolutions('video-compress');
    await sessionChecked();
    chooseFiles([new File(['raw video'], 'clip.mp4', { type: 'video/mp4' })]);
    fireEvent.click(processButton());
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();
  }

  it('warns a guest to keep it open, and cannot be closed', async () => {
    await startVideoJob();

    expect(screen.getByText(/Keep this panel open/)).toBeTruthy();
    expect(closeButton()).toBeNull();
  });

  it('does not tell a signed-in user they can close it, since it stays open until the job ends', async () => {
    signedInUser = { plan: 'Basic' };
    await startVideoJob();

    expect(screen.queryByText(/You can close this panel/)).toBeNull();
    expect(screen.queryByText(/Keep this panel open/)).toBeNull();
    expect(closeButton()).toBeNull();
  });
});

describe('the address', () => {
  it('follows opening and closing a tool from the list, without a reload', async () => {
    renderSolutions(null);
    await sessionChecked();
    expect(sheet()).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: /Lock PDF/ }));

    expect(window.location.pathname).toBe('/solutions/lock-pdf');
    expect(await screen.findByRole('heading', { name: 'Lock PDF' })).toBeTruthy();
    expect(document.title).toBe('Lock PDF | Vellum');

    fireEvent.click(closeButton()!);

    await waitFor(() => expect(window.location.pathname).toBe('/solutions'));
    await waitFor(() => expect(sheet()).toBeNull());
    expect(document.title).toBe('Solutions | Vellum');
  });

  it('goes back to /solutions when a sheet opened at its own address is closed', async () => {
    at('/solutions/lock-pdf');
    renderSolutions('lock-pdf');
    await sessionChecked();

    fireEvent.click(closeButton()!);

    await waitFor(() => expect(sheet()).toBeNull());
    expect(window.location.pathname).toBe('/solutions');
  });

  it('closes the sheet on Back', async () => {
    renderSolutions(null);
    await sessionChecked();
    fireEvent.click(screen.getByRole('link', { name: /Compress PDF/ }));
    expect(sheet()).toBeTruthy();

    act(() => window.history.back());

    await waitFor(() => expect(sheet()).toBeNull());
    expect(window.location.pathname).toBe('/solutions');
  });

  it('keeps the sheet and its address on Back while a file is processing', async () => {
    renderSolutions(null);
    await sessionChecked();
    fireEvent.click(screen.getByRole('link', { name: /Merge PDF/ }));
    await startMergeThatHangs();

    act(() => window.history.back());

    await waitFor(() => expect(window.location.pathname).toBe('/solutions/merge-pdf'));
    expect(sheet()).toBeTruthy();
  });
});

describe('the Solutions list', () => {
  it('links every tool to its own address', async () => {
    renderSolutions(null);
    await sessionChecked();

    for (const tool of ALL_TOOLS) {
      expect(screen.getByRole('link', { name: new RegExp(tool.title) }).getAttribute('href')).toBe(`/solutions/${tool.id}`);
    }
  });
});

describe('keyboard focus', () => {
  it('moves into the sheet, is trapped there, and returns to the link on close', async () => {
    renderSolutions(null);
    await sessionChecked();
    const link = screen.getByRole('link', { name: /Compress PDF/ });
    link.focus();
    fireEvent.click(link);

    const dialog = sheet()!;
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="file"]), select, a[href]'),
    );
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);

    focusable[0].focus();
    fireEvent.keyDown(focusable[0], { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(sheet()).toBeNull());
    expect(document.activeElement).toBe(link);
  });
});

describe('/solutions/[tool]', () => {
  it('builds one static page per tool and no others', () => {
    expect(toolPage.generateStaticParams()).toEqual(ALL_TOOLS.map((tool) => ({ tool: tool.id })));
    expect(toolPage.dynamicParams).toBe(false);
  });

  it('gives an unknown tool a 404', async () => {
    await expect(toolPage.default({ params: Promise.resolve({ tool: 'not-a-tool' }) })).rejects.toThrow('404');
    await expect(toolPage.generateMetadata({ params: Promise.resolve({ tool: 'not-a-tool' }) })).rejects.toThrow('404');
  });

  it("takes each tool's title and description from the tool list", async () => {
    for (const tool of ALL_TOOLS) {
      const metadata = await toolPage.generateMetadata({ params: Promise.resolve({ tool: tool.id }) });
      expect(String(metadata.title)).toContain(tool.title);
      expect(metadata.description).toBe(tool.desc);
    }
  });
});

describe('the dashboard drawer', () => {
  function renderDashboardDrawer(onClose: () => void) {
    return render(
      <ToolHostProvider value={{ user: { plan: 'Basic' }, showToast: jest.fn(), addNotification: jest.fn() }}>
        <SideDrawer isOpen onClose={onClose} file={null} toolId="merge-pdf" />
      </ToolHostProvider>,
    );
  }

  it('is still a side panel on desktop, not a dialog sheet', () => {
    renderDashboardDrawer(jest.fn());

    expect(sheet()).toBeNull();
    expect(screen.queryByTestId('sheet-drag-handle')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Merge PDF' })).toBeTruthy();
  });

  it('can still be closed while processing, as before', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const onClose = jest.fn();
    renderDashboardDrawer(onClose);
    chooseFiles([pdf('a.pdf'), pdf('b.pdf')]);
    fireEvent.click(processButton());
    expect(await screen.findByText('Processing...')).toBeTruthy();

    fireEvent.click(closeButton()!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
