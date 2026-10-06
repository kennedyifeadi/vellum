import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let mockRecentActivity: any[] = [];

jest.mock('@/app/dashboard/layout', () => ({
  useDashboard: () => ({
    recentActivity: mockRecentActivity,
    refreshData: jest.fn(),
    unreadCount: 0,
    openDrawer: jest.fn(),
  }),
}));

jest.mock('@/components/dashboard/DashboardHeader', () => ({
  __esModule: true,
  default: () => null,
}));

import DownloadAction from '../components/dashboard/DownloadAction';
import ActivityTable from '../components/dashboard/ActivityTable';
import RecentFilesPage from '../app/dashboard/recent/page';

const DOWNLOAD_ICON_PATH = 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4';
const DELETE_ICON_PATH = 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862';

function row(overrides: Record<string, unknown>) {
  return {
    _id: 'row-1',
    toolUsed: 'PDF to DOCX',
    fileName: 'report.docx',
    status: 'Completed',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const downloadableRow = row({ outputUrl: '/api/download/3f0c1d52-8f5e-4c53-9a44-0b8f1e0c7a11' });
const historyOnlyRow = row({ _id: 'row-2', toolUsed: 'Compress Video', fileName: 'clip.mp4' });
const legacySuccessRow = row({ _id: 'row-3', toolUsed: 'Find in PDF', fileName: 'doc.pdf', status: 'success' });

function count(markup: string, needle: string) {
  return markup.split(needle).length - 1;
}

describe('DownloadAction', () => {
  it('renders the control when the row has an output', () => {
    const markup = renderToStaticMarkup(
      <DownloadAction outputUrl="/api/download/abc" className="download" title="Download">
        Download
      </DownloadAction>,
    );

    expect(markup).toBe('<button class="download" title="Download">Download</button>');
  });

  it.each([undefined, ''])('renders nothing when outputUrl is %p', (outputUrl) => {
    const markup = renderToStaticMarkup(
      <DownloadAction outputUrl={outputUrl} className="download">
        Download
      </DownloadAction>,
    );

    expect(markup).toBe('');
  });
});

describe('dashboard activity table', () => {
  it('offers a download only for the row that has an output, and keeps delete on every row', () => {
    mockRecentActivity = [downloadableRow, historyOnlyRow, legacySuccessRow];

    const markup = renderToStaticMarkup(<ActivityTable />);

    expect(count(markup, '>Download</button>')).toBe(1);
    expect(count(markup, 'title="Delete"')).toBe(3);
    expect(markup).toContain('clip.mp4');
    expect(markup).toContain('doc.pdf');
  });

  it('renders no download control when no row has an output', () => {
    mockRecentActivity = [historyOnlyRow, legacySuccessRow];

    const markup = renderToStaticMarkup(<ActivityTable />);

    expect(markup).not.toContain('>Download</button>');
    expect(count(markup, 'title="Delete"')).toBe(2);
  });
});

describe('recent files page', () => {
  it('offers a download in the desktop row and mobile card only for the row that has an output', () => {
    mockRecentActivity = [downloadableRow, historyOnlyRow, legacySuccessRow];

    const markup = renderToStaticMarkup(<RecentFilesPage />);

    expect(count(markup, DOWNLOAD_ICON_PATH)).toBe(2);
    expect(count(markup, DELETE_ICON_PATH)).toBe(6);
  });

  it('renders no download control when no row has an output', () => {
    mockRecentActivity = [historyOnlyRow, legacySuccessRow];

    const markup = renderToStaticMarkup(<RecentFilesPage />);

    expect(markup).not.toContain(DOWNLOAD_ICON_PATH);
    expect(count(markup, DELETE_ICON_PATH)).toBe(4);
  });
});
