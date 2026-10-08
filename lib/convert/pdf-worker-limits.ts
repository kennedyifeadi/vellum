import { NextResponse } from 'next/server';

const BUSY_RETRY_AFTER_SECONDS = 5;

// What bounds a PDF extraction worker whichever tool starts it. Each tool adds its own
// deadlines, sized to the documents its caps allow.
export const PDF_WORKER_LIMITS = {
  // The largest PDF to Word allows (500 pages of 80 lines) needs between 48 and 64 MB
  // of heap. This bounds the worker's JavaScript heap only: a decoded content stream is
  // held outside it, and is bounded by the deadline alone.
  maxHeapMb: 256,
  // Each extraction keeps a CPU core busy for its whole duration, so this is how many
  // cores PDF extraction may take from the rest of the server, counted across every
  // tool that extracts.
  maxConcurrent: 2,
};

export function pdfTooComplexMessage(action: string): string {
  return `This PDF is too complex to ${action}. Splitting it into smaller files may help.`;
}

export function pdfToolBusyMessage(toolName: string): string {
  return `${toolName} is busy right now. Please try again in a few seconds.`;
}

export function busyResponse(message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 503, headers: { 'Retry-After': String(BUSY_RETRY_AFTER_SECONDS) } },
  );
}
