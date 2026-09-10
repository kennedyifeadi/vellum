import { ClientError, handleConvertError } from '../lib/convert/errors';

describe('handleConvertError (lib/convert/errors.ts)', () => {
  it('maps a ClientError to its own status and message', async () => {
    const res = handleConvertError(new ClientError('This PDF is password-protected.'), 'Failed to compress PDF.');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'This PDF is password-protected.' });
  });

  it('honours a non-default status on the ClientError', async () => {
    const res = handleConvertError(new ClientError('Plan limit exceeded.', 402), 'Failed.');

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'Plan limit exceeded.' });
  });

  it('collapses a generic Error to a 500 with the fallback message', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const underlying = new Error('ECONNREFUSED 127.0.0.1:27017');

    const res = handleConvertError(underlying, 'Failed to compress PDF.');

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to compress PDF.' });
    expect(spy).toHaveBeenCalledWith('[convert] Failed to compress PDF.', underlying);
    spy.mockRestore();
  });

  it('does not leak the underlying error message to the client on a 500', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = handleConvertError(new Error('/var/app/lib/pdf/compress.ts:214 boom'), 'Failed to compress PDF.');

    const body = await res.json();
    expect(body.error).toBe('Failed to compress PDF.');
    expect(JSON.stringify(body)).not.toContain('/var/app');
  });
});

describe('ClientError', () => {
  it('defaults to status 400 and is an Error instance', () => {
    const err = new ClientError('bad input');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.name).toBe('ClientError');
    expect(err.message).toBe('bad input');
  });

  it('preserves an underlying cause when given one', () => {
    const cause = new Error('No PDF header found');
    const err = new ClientError('The PDF file is not a valid PDF or is corrupted.', 400, { cause });
    expect(err.cause).toBe(cause);
  });
});
