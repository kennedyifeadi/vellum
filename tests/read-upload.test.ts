import { ClientError } from '@/lib/convert/errors';
import {
  MULTIPART_OVERHEAD_BYTES,
  NOT_MULTIPART_MESSAGE,
  readMultipartForm,
  textField,
  UNREADABLE_UPLOAD_MESSAGE,
  type UploadBudget,
} from '@/lib/http/read-upload';
import { formRequest, MB, MULTIPART_CONTENT_TYPE, rawRequest, streamedUpload } from './helpers/uploadRequests';

const URL = 'http://localhost:3000/api/convert/anything';
const TOO_LARGE_MESSAGE = 'Your current plan allows files up to 25MB.';

function budget(maxBytes = 25 * MB): UploadBudget & { tooLarge: jest.Mock } {
  return { maxBytes, tooLarge: jest.fn(() => new ClientError(TOO_LARGE_MESSAGE)) };
}

async function rejectionOf(promise: Promise<unknown>): Promise<ClientError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ClientError);
  return error as ClientError;
}

describe('readMultipartForm', () => {
  it('refuses a Content-Length over the budget without reading any of the body', async () => {
    const upload = streamedUpload(URL, 'pdf', 400 * MB);
    const limits = budget();

    const error = await rejectionOf(readMultipartForm(upload.request, limits));

    expect(error.message).toBe(TOO_LARGE_MESSAGE);
    expect(error.status).toBe(400);
    expect(limits.tooLarge).toHaveBeenCalledWith();
    expect(upload.bytesRead()).toBe(0);
  });

  it('cuts off a body without a Content-Length once it passes the budget', async () => {
    const upload = streamedUpload(URL, 'pdf', 400 * MB, { declareLength: false });
    const limits = budget();

    const error = await rejectionOf(readMultipartForm(upload.request, limits));

    expect(error.message).toBe(TOO_LARGE_MESSAGE);
    expect(limits.tooLarge).toHaveBeenCalledWith();
    // Reading stops within one chunk of the budget, not at the end of the body.
    expect(upload.bytesRead()).toBeLessThanOrEqual(25 * MB + MULTIPART_OVERHEAD_BYTES + 2 * MB);
  });

  it.each([
    ['with a Content-Length', true],
    ['without a Content-Length', false],
  ])('reads an upload at the budget %s', async (_label, declareLength) => {
    const upload = streamedUpload(URL, 'pdf', 25 * MB, { declareLength, fileName: 'at-cap.pdf' });

    const form = await readMultipartForm(upload.request, budget());

    const file = form.get('pdf') as File;
    expect(file.name).toBe('at-cap.pdf');
    expect(file.size).toBe(25 * MB);
  });

  it('allows the stated multipart overhead and no more', async () => {
    const atAllowance = streamedUpload(URL, 'pdf', 1 * MB + MULTIPART_OVERHEAD_BYTES - 300);
    await expect(readMultipartForm(atAllowance.request, budget(1 * MB))).resolves.toBeInstanceOf(FormData);

    const overAllowance = streamedUpload(URL, 'pdf', 1 * MB + MULTIPART_OVERHEAD_BYTES);
    await expect(readMultipartForm(overAllowance.request, budget(1 * MB))).rejects.toThrow(TOO_LARGE_MESSAGE);
  });

  it('reads the fields of an ordinary form', async () => {
    const request = formRequest(URL, [
      ['pdf', { bytes: '%PDF-1.7', name: 'a.pdf' }],
      ['searchTerm', 'hello'],
    ]);

    const form = await readMultipartForm(request, budget());

    expect((form.get('pdf') as File).name).toBe('a.pdf');
    expect(form.get('searchTerm')).toBe('hello');
  });

  it.each([
    ['a JSON body', JSON.stringify({ pdf: 'x' }), 'application/json'],
    ['a url-encoded form', 'pdf=x', 'application/x-www-form-urlencoded'],
    ['plain text', 'hello', 'text/plain'],
    ['no content type', 'hello', undefined],
    ['an empty POST', null, undefined],
    ['multipart without a boundary', 'x', 'multipart/form-data'],
  ])('refuses %s with a 400', async (_label, body, contentType) => {
    const error = await rejectionOf(readMultipartForm(rawRequest(URL, body, contentType), budget()));

    expect(error.status).toBe(400);
    expect(error.message).toBe(NOT_MULTIPART_MESSAGE);
  });

  it.each([
    ['a body that is not multipart', 'garbage'],
    ['an empty body', ''],
    ['a truncated part', '------vellum-test-boundary\r\nContent-Disposition: form-data; name="pdf"; filename="a.pdf"\r\n\r\n%PDF'],
  ])('refuses %s under a multipart content type with a 400', async (_label, body) => {
    const error = await rejectionOf(readMultipartForm(rawRequest(URL, body, MULTIPART_CONTENT_TYPE), budget()));

    expect(error.status).toBe(400);
    expect(error.message).toBe(UNREADABLE_UPLOAD_MESSAGE);
  });
});

describe('textField', () => {
  it('returns text and null for a missing field', () => {
    const form = new FormData();
    form.set('searchTerm', 'hello');

    expect(textField(form, 'searchTerm')).toBe('hello');
    expect(textField(form, 'missing')).toBeNull();
  });

  it('refuses a file where text is expected', () => {
    const form = new FormData();
    form.set('password', new File(['secret'], 'password.txt'));

    expect(() => textField(form, 'password')).toThrow(ClientError);
    expect(() => textField(form, 'password')).toThrow('The "password" field must be text, not a file.');
  });
});
