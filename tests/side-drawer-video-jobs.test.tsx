/** @jest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VIDEO_JOB_POLL_INTERVAL_MS, VIDEO_JOB_RETRY } from '@/lib/video-job-client';

const mockShowToast = jest.fn();
const mockAddNotification = jest.fn();
let mockUser: { plan: string } | null = { plan: 'Basic' };

jest.mock('@/app/dashboard/layout', () => ({
  useDashboard: () => ({ showToast: mockShowToast, addNotification: mockAddNotification, user: mockUser }),
}));

jest.mock('next/script', () => ({ __esModule: true, default: () => null }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

import SideDrawer from '../components/dashboard/SideDrawer';

jest.setTimeout(30_000);

const JOB_ID = '6730a1b2c3d4e5f6a7b8c9d0';
const JOB_PATH = `/api/convert/video-compress/jobs/${JOB_ID}`;

function answer(status: number, json: unknown = {}, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => json, blob: async () => new Blob(['mp4']) };
}

const statusOf = (status: string, extra: Record<string, unknown> = {}) => ({ status, fileName: 'clip.mp4', originalSize: 10 * 1024 * 1024, ...extra });

let fetchMock: jest.Mock;
let statuses: Record<string, unknown>[];
let downloadHeaders: Record<string, string>;

function requests(method: string, path: string) {
  return fetchMock.mock.calls.filter(([url, init]) => url === path && (init?.method ?? 'GET') === method);
}

function renderDrawer(onClose = jest.fn(), video = new File(['raw video'], 'clip.mp4', { type: 'video/mp4' })) {
  const view = render(<SideDrawer isOpen onClose={onClose} file={null} toolId="video-compress" />);
  const input = view.container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [video] } });
  return { ...view, onClose };
}

async function poll() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(VIDEO_JOB_POLL_INTERVAL_MS);
  });
}

function processButton() {
  return screen.getByRole('button', { name: /Process File|Processing|Queued|Compressing/ });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockShowToast.mockReset();
  mockAddNotification.mockReset();
  mockUser = { plan: 'Basic' };
  statuses = [statusOf('queued', { position: 1 }), statusOf('running'), statusOf('done', { savedPercent: 40, compressedSize: 6 * 1024 * 1024 })];
  downloadHeaders = {};
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/convert/video-compress') return answer(202, { jobId: JOB_ID, status: 'queued', ...(mockUser ? {} : { token: 'guest-token' }) });
    if (url === JOB_PATH && init?.method === 'DELETE') return answer(200, { status: 'cancelled' });
    if (url === JOB_PATH) {
      const next = statuses.length > 1 ? statuses.shift()! : statuses[0];
      if (next.fail === 'network') throw new TypeError('Failed to fetch');
      if (typeof next.fail === 'number') return answer(next.fail);
      return answer(200, next);
    }
    if (url === `${JOB_PATH}/download`) return answer(200, {}, downloadHeaders);
    return answer(404);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  URL.createObjectURL = jest.fn(() => 'blob:result');
  URL.revokeObjectURL = jest.fn();
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Compress Video in the drawer', () => {
  it('uploads once, shows the queue and the encode, then downloads the result with its saving', async () => {
    const saved: string[] = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    const activity = jest.fn();
    window.addEventListener('activityUpdated', activity);
    const { onClose } = renderDrawer();

    fireEvent.click(processButton());
    expect(await screen.findByText('Queued (1 ahead)…')).toBeTruthy();
    await poll();
    expect(screen.getByText('Compressing…')).toBeTruthy();
    await poll();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Reduced by 40% — 4.0 MB saved!', 'success'));
    expect(requests('POST', '/api/convert/video-compress')).toHaveLength(1);
    expect(requests('GET', `${JOB_PATH}/download`)).toHaveLength(1);
    expect(saved).toEqual(['compressed_clip.mp4']);
    expect(onClose).toHaveBeenCalled();
    expect(activity).toHaveBeenCalled();
    // The server notifies the owner itself; the drawer adds no second notification.
    expect(mockAddNotification).not.toHaveBeenCalled();
    window.removeEventListener('activityUpdated', activity);
  });

  it('cancels the job from the drawer and stops following it', async () => {
    renderDrawer();
    fireEvent.click(processButton());
    expect(await screen.findByText('Queued (1 ahead)…')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Video compression cancelled.', 'info'));
    await poll();
    await poll();

    expect(requests('DELETE', JOB_PATH)).toHaveLength(1);
    expect(requests('GET', JOB_PATH)).toHaveLength(1);
    expect(requests('GET', `${JOB_PATH}/download`)).toHaveLength(0);
    expect(screen.getByText('Process File')).toBeTruthy();
    expect(screen.getByText('clip.mp4')).toBeTruthy();
  });

  it("shows a failed job's reason and downloads nothing", async () => {
    statuses = [statusOf('failed', { error: 'This video could not be compressed in time.' })];
    renderDrawer();

    fireEvent.click(processButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('This video could not be compressed in time.', 'error'));
    expect(requests('GET', `${JOB_PATH}/download`)).toHaveLength(0);
  });

  it('shows the upload refusal as before, without following a job', async () => {
    fetchMock.mockImplementationOnce(async () => answer(400, { error: 'This video would take too long to compress.' }));
    renderDrawer();

    fireEvent.click(processButton());

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('This video would take too long to compress.', 'error'));
    expect(requests('GET', JOB_PATH)).toHaveLength(0);
  });

  it('tells a signed-in user who closes the drawer they will be notified, and does not download later', async () => {
    const { rerender, onClose } = renderDrawer();
    fireEvent.click(processButton());
    expect(await screen.findByText('Queued (1 ahead)…')).toBeTruthy();
    expect(screen.getByText(/We'll notify you when your video is ready/)).toBeTruthy();

    rerender(<SideDrawer isOpen={false} onClose={onClose} file={null} toolId="video-compress" />);
    expect(mockShowToast).toHaveBeenCalledWith("Your video is still being compressed. We'll notify you when it's ready.", 'info');
    await poll();
    await poll();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('"clip.mp4" is compressed. Download it from your notifications.', 'success'));
    expect(requests('GET', `${JOB_PATH}/download`)).toHaveLength(0);
    expect(requests('DELETE', JOB_PATH)).toHaveLength(0);
  });

  it("sends a guest's token, warns that closing loses the video, and stops following it when closed", async () => {
    mockUser = null;
    const { rerender, onClose } = renderDrawer();
    fireEvent.click(processButton());
    expect(await screen.findByText('Queued (1 ahead)…')).toBeTruthy();
    expect(screen.getByText(/as a guest, closing it loses your compressed video/)).toBeTruthy();
    expect(requests('GET', JOB_PATH)[0][1].headers).toEqual({ 'X-Job-Token': 'guest-token' });

    rerender(<SideDrawer isOpen={false} onClose={onClose} file={null} toolId="video-compress" />);
    await poll();
    await poll();

    expect(requests('GET', JOB_PATH)).toHaveLength(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('rides out failed polls mid-job and still downloads the result', async () => {
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    statuses = [
      statusOf('running'),
      { fail: 'network' },
      { fail: 502 },
      statusOf('running'),
      statusOf('done', { savedPercent: 40, compressedSize: 6 * 1024 * 1024 }),
    ];
    renderDrawer();

    fireEvent.click(processButton());
    expect(await screen.findByText('Compressing…')).toBeTruthy();
    for (let i = 0; i < 6; i++) await poll();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Reduced by 40% — 4.0 MB saved!', 'success'));
    expect(requests('GET', `${JOB_PATH}/download`)).toHaveLength(1);
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  async function loseContact() {
    statuses = [statusOf('running'), { fail: 503 }];
    const view = renderDrawer();
    fireEvent.click(processButton());
    expect(await screen.findByText('Compressing…')).toBeTruthy();
    await act(async () => {
      // Past the two minutes, plus the last pause before the poll that gives up.
      await jest.advanceTimersByTimeAsync(VIDEO_JOB_RETRY.giveUpAfterMs + 2 * VIDEO_JOB_RETRY.maxDelayMs);
    });
    return view;
  }

  it('tells a signed-in user who lost contact that they will be notified, not that the video failed', async () => {
    await loseContact();

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("Lost contact with the server. We'll notify you when your video is ready.", 'info'),
    );
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(requests('DELETE', JOB_PATH)).toHaveLength(0);
    expect(screen.getByText('Process File')).toBeTruthy();
  });

  it('tells a guest who lost contact plainly that the result cannot be fetched', async () => {
    mockUser = null;
    await loseContact();

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'Lost contact with the server, so the compressed video can no longer be fetched. Please upload it again.',
        'error',
      ),
    );
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });

  function savedNames() {
    const saved: string[] = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    return saved;
  }

  async function compressToTheEnd(video: File) {
    renderDrawer(jest.fn(), video);
    fireEvent.click(processButton());
    expect(await screen.findByText('Queued (1 ahead)…')).toBeTruthy();
    await poll();
    await poll();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Reduced by 40% — 4.0 MB saved!', 'success'));
  }

  it("saves the result under the download's Content-Disposition name", async () => {
    downloadHeaders = { 'Content-Disposition': `attachment; filename="compressed_holiday.mp4"; filename*=UTF-8''compressed_holiday.mp4` };
    const saved = savedNames();

    await compressToTheEnd(new File(['raw video'], 'holiday.mov', { type: 'video/quicktime' }));

    expect(saved).toEqual(['compressed_holiday.mp4']);
  });

  it("takes a non-ASCII name from the header's filename*", async () => {
    downloadHeaders = {
      'Content-Disposition': `attachment; filename="compressed___.mp4"; filename*=UTF-8''compressed_%E6%97%85%E8%A1%8C.mp4`,
    };
    const saved = savedNames();

    await compressToTheEnd(new File(['raw video'], '旅行.mov', { type: 'video/quicktime' }));

    expect(saved).toEqual(['compressed_旅行.mp4']);
  });

  it('names a .mov result .mp4 when the download has no Content-Disposition', async () => {
    const saved = savedNames();

    await compressToTheEnd(new File(['raw video'], 'holiday.mov', { type: 'video/quicktime' }));

    expect(saved).toEqual(['compressed_holiday.mp4']);
  });

});
