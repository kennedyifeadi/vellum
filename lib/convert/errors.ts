import { NextResponse } from 'next/server';

/**
 * A fault caused by the caller's input (missing, malformed, corrupt, or encrypted
 * file, a plan limit exceeded, …) rather than by the server. The message is written
 * to be shown directly to the end user, so it must never carry a stack trace or an
 * internal path.
 */
export class ClientError extends Error {
  readonly status: number;

  constructor(message: string, status = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClientError';
    this.status = status;
  }
}

/**
 * Maps a thrown error to a route response. A `ClientError` keeps its safe message and
 * 4xx status; anything else is a genuine server fault and collapses to a generic 500
 * with `fallbackMessage`, logging the original for the operator.
 */
export function handleConvertError(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof ClientError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(`[convert] ${fallbackMessage}`, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
