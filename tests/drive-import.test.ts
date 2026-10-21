import { NextRequest } from 'next/server';
import { ClientError, UpstreamError } from '@/lib/convert/errors';
import {
  DRIVE_ACCESS_DENIED_MESSAGE,
  DRIVE_TIMEOUT_MESSAGE,
  DRIVE_UNAVAILABLE_MESSAGE,
  INVALID_DRIVE_SELECTION_MESSAGE,
  resolveFiles,
} from '@/lib/drive/resolveFiles';
import { uploadBudget } from '@/lib/http/read-upload';
import { MB } from './helpers/uploadRequests';

const TOO_LARGE_MESSAGE = 'Your current plan allows PDFs up to 25MB.';
const FILE_ID = 'abc_DEF-123';

interface DriveFile {
  name?: string;
  /** What the metadata reports; undefined leaves `size` out, as Drive does for Docs files. */
  reportedSize?: number;
  mimeType?: string;
  /** The bytes the download actually streams. */
  actualSize: number;
  /** Whether the download carries a Content-Length. */
  declareLength?: boolean;
}

interface DriveCalls {
  urls: string[];
  downloadedBytes: number;
  downloadCancelled: boolean;
  signals: (AbortSignal | null | undefined)[];
  authorizations: (string | null)[];
}

let calls: DriveCalls;

function lazyBody(size: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(MB);
  let left = size;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (left === 0) {
          controller.close();
          return;
        }
        const piece = chunk.subarray(0, Math.min(chunk.length, left));
        left -= piece.length;
        calls.downloadedBytes += piece.length;
        controller.enqueue(piece);
      },
      cancel() {
        calls.downloadCancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
}

function serveDrive(file: DriveFile) {
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.urls.push(url);
    calls.signals.push(init?.signal);
    calls.authorizations.push(new Headers(init?.headers).get('authorization'));

    if (url.includes('alt=media')) {
      const headers: Record<string, string> = {};
      if (file.declareLength) headers['content-length'] = String(file.actualSize);
      return new Response(lazyBody(file.actualSize), { headers });
    }
    return Response.json({
      name: file.name ?? 'report.pdf',
      mimeType: file.mimeType ?? 'application/pdf',
      ...(file.reportedSize === undefined ? {} : { size: String(file.reportedSize) }),
    });
  }) as unknown as typeof fetch;
}

function failDrive(respond: () => Promise<Response>) {
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    calls.urls.push(String(input));
    return respond();
  }) as unknown as typeof fetch;
}

function driveForm(selections: unknown[], localFiles: File[] = []): FormData {
  const form = new FormData();
  for (const file of localFiles) form.append('pdf', file);
  for (const selection of selections) {
    form.append('googleDriveFiles', typeof selection === 'string' ? selection : JSON.stringify(selection));
  }
  return form;
}

const selection = (overrides: Record<string, unknown> = {}) => ({
  id: FILE_ID,
  accessToken: 'ya29.token',
  name: 'from-the-browser.exe',
  ...overrides,
});

const budget = (maxBytes = 25 * MB) => uploadBudget(maxBytes, TOO_LARGE_MESSAGE);

async function failureOf(promise: Promise<unknown>): Promise<Error> {
  const outcome = await promise.then(
    () => new Error('expected the import to fail'),
    (error: Error) => error,
  );
  return outcome;
}

const originalFetch = global.fetch;

beforeEach(() => {
  calls = { urls: [], downloadedBytes: 0, downloadCancelled: false, signals: [], authorizations: [] };
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('Google Drive selections', () => {
  it.each([
    ['a path', '../../about'],
    ['a query', 'abc?alt=media'],
    ['a fragment', 'abc#x'],
    ['a slash', 'abc/def'],
    ['an encoded slash', 'abc%2Fdef'],
    ['an empty id', ''],
    ['a number', 12345],
    ['no id', undefined],
  ])('refuses an id that is %s without calling Drive', async (_label, id) => {
    serveDrive({ actualSize: 10 });

    const error = await failureOf(resolveFiles(driveForm([selection({ id })]), 'pdf', budget()));

    expect(error).toBeInstanceOf(ClientError);
    expect(error.message).toBe(INVALID_DRIVE_SELECTION_MESSAGE);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a number', 42],
    ['an object', { token: 'x' }],
    ['missing', undefined],
    ['empty', ''],
  ])('refuses an access token that is %s without calling Drive', async (_label, accessToken) => {
    serveDrive({ actualSize: 10 });

    const error = await failureOf(resolveFiles(driveForm([selection({ accessToken })]), 'pdf', budget()));

    expect(error).toBeInstanceOf(ClientError);
    expect(error.message).toBe(INVALID_DRIVE_SELECTION_MESSAGE);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'not json'],
    ['JSON null', 'null'],
    ['a JSON string', '"abc"'],
  ])('refuses a selection that is %s', async (_label, raw) => {
    serveDrive({ actualSize: 10 });

    const error = await failureOf(resolveFiles(driveForm([raw]), 'pdf', budget()));

    expect(error).toBeInstanceOf(ClientError);
    expect(error.message).toBe(INVALID_DRIVE_SELECTION_MESSAGE);
  });

  it('refuses a selection sent as a file', async () => {
    serveDrive({ actualSize: 10 });
    const form = new FormData();
    form.append('googleDriveFiles', new File(['{}'], 'selection.json'));

    const error = await failureOf(resolveFiles(form, 'pdf', budget()));

    expect(error.message).toBe(INVALID_DRIVE_SELECTION_MESSAGE);
  });
});

describe('Google Drive import', () => {
  it("imports a file under Drive's name and type, not the browser's", async () => {
    serveDrive({ name: '季度报告 "final".pdf', mimeType: 'application/pdf', reportedSize: 3 * MB, actualSize: 3 * MB });

    const [file] = await resolveFiles(driveForm([selection()]), 'pdf', budget());

    expect(file.name).toBe('季度报告 "final".pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBe(3 * MB);
  });

  it('asks Drive for exactly the selected file, with the caller\'s token and a deadline', async () => {
    serveDrive({ reportedSize: 10, actualSize: 10 });

    await resolveFiles(driveForm([selection()]), 'pdf', budget());

    expect(calls.urls).toEqual([
      `https://www.googleapis.com/drive/v3/files/${FILE_ID}?fields=name,size,mimeType&supportsAllDrives=true`,
      `https://www.googleapis.com/drive/v3/files/${FILE_ID}?alt=media&supportsAllDrives=true`,
    ]);
    expect(calls.authorizations).toEqual(['Bearer ya29.token', 'Bearer ya29.token']);
    expect(calls.signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it('refuses a file whose metadata is over the cap without downloading it', async () => {
    serveDrive({ reportedSize: 400 * MB, actualSize: 400 * MB });

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error).toBeInstanceOf(ClientError);
    expect(error.message).toBe(TOO_LARGE_MESSAGE);
    expect(calls.urls.some((url) => url.includes('alt=media'))).toBe(false);
    expect(calls.downloadedBytes).toBe(0);
  });

  it('counts the uploaded files against the cap before importing', async () => {
    serveDrive({ reportedSize: 6 * MB, actualSize: 6 * MB });
    const local = new File([new Uint8Array(20 * MB)], 'local.pdf');

    const error = await failureOf(resolveFiles(driveForm([selection()], [local]), 'pdf', budget()));

    expect(error.message).toBe(TOO_LARGE_MESSAGE);
    expect(calls.downloadedBytes).toBe(0);
  });

  it('counts each imported file against the cap for the next', async () => {
    serveDrive({ reportedSize: 15 * MB, actualSize: 15 * MB });

    const error = await failureOf(resolveFiles(driveForm([selection(), selection()]), 'pdf', budget()));

    expect(error.message).toBe(TOO_LARGE_MESSAGE);
    expect(calls.urls.filter((url) => url.includes('alt=media'))).toHaveLength(1);
  });

  it('refuses a download whose Content-Length is over the cap without reading it', async () => {
    serveDrive({ actualSize: 400 * MB, declareLength: true });

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error.message).toBe(TOO_LARGE_MESSAGE);
    expect(calls.downloadedBytes).toBe(0);
    expect(calls.downloadCancelled).toBe(true);
  });

  it.each([
    ['reports no size', undefined],
    ['understates its size', 1 * MB],
  ])('aborts a download that overruns the cap when Drive %s', async (_label, reportedSize) => {
    serveDrive({ reportedSize, actualSize: 400 * MB });

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error).toBeInstanceOf(ClientError);
    expect(error.message).toBe(TOO_LARGE_MESSAGE);
    expect(calls.downloadCancelled).toBe(true);
    expect(calls.downloadedBytes).toBeLessThanOrEqual(26 * MB);
  });

  it('reports a timeout as Drive taking too long, not as a server fault', async () => {
    failDrive(() => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).status).toBe(504);
    expect(error.message).toBe(DRIVE_TIMEOUT_MESSAGE);
  });

  it('reports a timeout during the download the same way', async () => {
    serveDrive({ reportedSize: 10 * MB, actualSize: 10 * MB });
    const serve = global.fetch as jest.Mock;
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes('alt=media')) return serve(input, init);
      const stalled = new ReadableStream<Uint8Array>({
        pull() {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        },
      });
      return new Response(stalled);
    }) as unknown as typeof fetch;

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.message).toBe(DRIVE_TIMEOUT_MESSAGE);
  });

  it.each([400, 401, 403, 404])('turns Drive answering %i into a 400 the user can act on', async (status) => {
    failDrive(async () => Response.json({ error: { code: status } }, { status }));

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error).toBeInstanceOf(ClientError);
    expect((error as ClientError).status).toBe(400);
    expect(error.message).toBe(DRIVE_ACCESS_DENIED_MESSAGE);
  });

  it.each([429, 500, 502, 503])('reports Drive answering %i as Drive being unavailable', async (status) => {
    failDrive(async () => new Response('unavailable', { status }));

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).status).toBe(502);
    expect(error.message).toBe(DRIVE_UNAVAILABLE_MESSAGE);
  });

  it('reports a network failure as Drive being unavailable', async () => {
    failDrive(() => Promise.reject(new TypeError('fetch failed')));

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.message).toBe(DRIVE_UNAVAILABLE_MESSAGE);
  });

  it('reports metadata that is not JSON as Drive being unavailable', async () => {
    failDrive(async () => new Response('<html>', { status: 200 }));

    const error = await failureOf(resolveFiles(driveForm([selection()]), 'pdf', budget()));

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.message).toBe(DRIVE_UNAVAILABLE_MESSAGE);
  });
});

describe('uploaded files', () => {
  it('returns them without calling Drive', async () => {
    serveDrive({ actualSize: 10 });
    const local = new File(['%PDF-1.7'], 'local.pdf');

    const files = await resolveFiles(driveForm([], [local]), 'pdf', budget());

    expect(files.map((file) => file.name)).toEqual(['local.pdf']);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses text sent in the file field', async () => {
    const form = new FormData();
    form.append('pdf', 'not a file');

    const error = await failureOf(resolveFiles(form, 'pdf', budget()));

    expect(error).toBeInstanceOf(ClientError);
    expect(error.message).toBe('The "pdf" field must be a file.');
  });

  it('refuses a file without a name', async () => {
    const form = new FormData();
    form.append('pdf', new File(['%PDF-1.7'], ''));

    const error = await failureOf(resolveFiles(form, 'pdf', budget()));

    expect(error.message).toBe('Every uploaded file must have a name.');
  });
});

describe('Drive failures through a route', () => {
  // The route's own collaborators, so the request reaches resolveFiles as a guest.
  jest.mock('@/lib/auth/jwt', () => ({ getAuthUserId: jest.fn().mockResolvedValue(null) }));

  function compressRequest(form: FormData) {
    return new NextRequest('http://localhost:3000/api/convert/compress-pdf', { method: 'POST', body: form });
  }

  it.each([
    [503, 502, DRIVE_UNAVAILABLE_MESSAGE],
    [401, 400, DRIVE_ACCESS_DENIED_MESSAGE],
  ])('answers Drive returning %i with %i and its message', async (driveStatus, status, message) => {
    failDrive(async () => new Response('', { status: driveStatus }));
    const { POST } = await import('../app/api/convert/compress-pdf/route');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await POST(compressRequest(driveForm([selection()])));

    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(message);
  });

  it('answers an over-cap Drive file with the route\'s own size message', async () => {
    serveDrive({ reportedSize: 400 * MB, actualSize: 400 * MB });
    const { POST } = await import('../app/api/convert/compress-pdf/route');

    const res = await POST(compressRequest(driveForm([selection()])));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(TOO_LARGE_MESSAGE);
    expect(calls.downloadedBytes).toBe(0);
  });
});
