import { storedFileResponse, streamStoredFile } from '@/lib/http/stored-file-response';

type Source = {
  stream: ReadableStream<Uint8Array>;
  cancelled: Promise<void>;
  wasCancelled: () => boolean;
  pulled: () => number;
};

function sourceOf(chunks: Uint8Array[], { failAfter }: { failAfter?: number } = {}): Source {
  let markCancelled!: () => void;
  const cancelled = new Promise<void>((resolve) => (markCancelled = resolve));
  let isCancelled = false;
  let next = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (failAfter !== undefined && next === failAfter) {
          controller.error(new Error('storage connection reset'));
          return;
        }
        if (next === chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[next++]);
      },
      cancel() {
        isCancelled = true;
        markCancelled();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, cancelled, wasCancelled: () => isCancelled, pulled: () => next };
}

const bytes = (text: string) => new TextEncoder().encode(text);

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('storedFileResponse', () => {
  it('sends the file with its headers and a Content-Length from its size', async () => {
    const source = sourceOf([bytes('hello '), bytes('world')]);

    const res = storedFileResponse(
      new Request('http://localhost/file'),
      { stream: source.stream, size: 11 },
      { 'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff' },
      'a test file',
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe('11');
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toBe('hello world');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('streamStoredFile', () => {
  it('reads the file only as fast as the body is read', async () => {
    const chunks = Array.from({ length: 100 }, () => bytes('x'));
    const source = sourceOf(chunks);
    const body = streamStoredFile({ stream: source.stream, size: 100 }, new AbortController().signal, 'a test file');
    const reader = body.getReader();

    expect(new TextDecoder().decode((await reader.read()).value)).toBe('x');
    expect(source.pulled()).toBeLessThan(5);
    await reader.cancel();
    await source.cancelled;
  });

  it('cancels the file when the request is aborted mid-download', async () => {
    const source = sourceOf([bytes('first'), bytes('second'), bytes('third')]);
    const request = new AbortController();
    const body = streamStoredFile({ stream: source.stream, size: 16 }, request.signal, 'a test file');
    const reader = body.getReader();
    await reader.read();

    request.abort();

    await expect(source.cancelled).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('cancels the file at once when the request was already aborted', async () => {
    const source = sourceOf([bytes('never sent')]);
    const request = new AbortController();
    request.abort();

    streamStoredFile({ stream: source.stream, size: 10 }, request.signal, 'a test file');

    await expect(source.cancelled).resolves.toBeUndefined();
  });

  it('cancels the file when the body is cancelled', async () => {
    const source = sourceOf([bytes('first'), bytes('second')]);
    const body = streamStoredFile({ stream: source.stream, size: 11 }, new AbortController().signal, 'a test file');
    const reader = body.getReader();
    await reader.read();

    await reader.cancel();

    await expect(source.cancelled).resolves.toBeUndefined();
  });

  it('ends a body whose file fails part way as an abort, logging the failure once', async () => {
    const source = sourceOf([bytes('first'), bytes('second')], { failAfter: 1 });
    const body = streamStoredFile({ stream: source.stream, size: 11 }, new AbortController().signal, 'video 42');
    const reader = body.getReader();

    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
    const failure = await reader.read().then(
      () => null,
      (error: Error) => error,
    );

    expect(failure?.name).toBe('AbortError');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('video 42 (5 of 11 bytes sent)');
    expect(errorSpy.mock.calls[0][1]).toEqual(new Error('storage connection reset'));
  });

  it('treats a file that ends short of its size as a failure', async () => {
    const source = sourceOf([bytes('short')]);
    const body = streamStoredFile({ stream: source.stream, size: 100 }, new AbortController().signal, 'a test file');

    const failure = await new Response(body).arrayBuffer().then(
      () => null,
      (error: Error) => error,
    );

    expect(failure?.name).toBe('AbortError');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][1])).toContain('ended after 5 of 100 bytes');
  });

  it('does not log or touch the file again after a complete download is aborted', async () => {
    const source = sourceOf([bytes('done')]);
    const request = new AbortController();
    const body = streamStoredFile({ stream: source.stream, size: 4 }, request.signal, 'a test file');

    expect(await new Response(body).text()).toBe('done');
    request.abort();

    expect(source.wasCancelled()).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
