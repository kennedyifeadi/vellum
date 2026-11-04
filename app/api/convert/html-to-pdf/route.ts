import { NextRequest, NextResponse } from 'next/server';
import { convertHtmlToPdf } from '@/lib/html/to-pdf';
import { resolveCaller, type Caller } from '@/lib/auth/caller';
import { CallerJobRefusedError, callerJobRefusedResponse, runCallerJob, type CallerJob } from '@/lib/convert/caller-jobs';
import { saveConversionRecord } from '@/lib/conversions';
import { ensureExtension } from '@/lib/paths';
import { resolveFiles } from '@/lib/drive/resolveFiles';
import { resolvePlanLimit } from '@/lib/plan-limits';
import { TOOL_LIMITS } from '@/lib/tool-limits';
import { ClientError, handleConvertError } from '@/lib/convert/errors';
import { busyResponse } from '@/lib/convert/pdf-worker-limits';
import { BrowserToolBusyError, HTML_TO_PDF_BUSY_MESSAGE, runRenderJob } from '@/lib/puppeteer/render-jobs';
import { readBoundedBody, readMultipartForm, uploadBudget } from '@/lib/http/read-upload';
import { attachmentDisposition } from '@/lib/http/content-disposition';
import { assertWithinRateLimit } from '@/lib/http/rate-limit';

const HTML_REQUEST_MESSAGE = 'Send an HTML file as multipart/form-data, or JSON with a "url".';

// URL mode's body is `{ "url": ... }`; browsers cap URLs at a few tens of kilobytes.
const MAX_URL_REQUEST_BYTES = 64 * 1024;
const URL_REQUEST_TOO_LARGE_MESSAGE = 'The request is too large. Send JSON with just a "url".';

async function readJsonObject(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await (
    await readBoundedBody(req, MAX_URL_REQUEST_BYTES, () => new ClientError(URL_REQUEST_TOO_LARGE_MESSAGE))
  ).text();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new ClientError(HTML_REQUEST_MESSAGE, 400, { cause: error });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ClientError(HTML_REQUEST_MESSAGE);
  }
  return body as Record<string, unknown>;
}

async function convertRequest(req: NextRequest, { userId, plan }: Caller, job: CallerJob): Promise<NextResponse> {
  const maxSize = resolvePlanLimit(plan, TOOL_LIMITS['html-to-pdf'].maxBytes);

  let htmlContent: string | undefined;
  let url: string | undefined;
  let outputFileName = 'converted.pdf';

  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    // File upload mode
    const budget = uploadBudget(maxSize, `Your current plan allows HTML files up to ${maxSize / (1024 * 1024)}MB.`);
    const formData = await readMultipartForm(req, budget);
    const file = (await resolveFiles(formData, 'html', budget))[0] as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No HTML file provided.' }, { status: 400 });
    }
    if (file.size > maxSize) {
      throw budget.tooLarge(file.size);
    }
    if (file.size === 0) {
      throw new ClientError('The HTML file is empty.');
    }
    htmlContent = await file.text();
    outputFileName = file.name.replace(/\.html?$/i, '.pdf');
  } else {
    // URL mode
    const body = await readJsonObject(req);
    url = typeof body.url === 'string' ? body.url : undefined;
    if (!url) {
      return NextResponse.json({ error: 'No URL provided.' }, { status: 400 });
    }
    try {
      const hostname = new URL(url).hostname;
      outputFileName = `${hostname}.pdf`;
    } catch {
      outputFileName = 'webpage.pdf';
    }
  }

  const pdfBuffer = await job.inPools(['browser'], () => runRenderJob(() => convertHtmlToPdf({ htmlContent, url })));

  // Built before anything is recorded, so a response that cannot be built leaves no
  // history row behind.
  const response = new NextResponse(pdfBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': attachmentDisposition(outputFileName, 'converted.pdf'),
    },
  });

  if (userId) {
    try {
      await saveConversionRecord(userId, 'HTML to PDF', ensureExtension(outputFileName, '.pdf'), Buffer.from(pdfBuffer));
    } catch (recordError) {
      console.error('Failed to record HTML to PDF conversion:', recordError);
    }
  }

  return response;
}

export async function POST(req: NextRequest) {
  try {
    assertWithinRateLimit(req);

    const caller = await resolveCaller(req);
    return await runCallerJob(req, caller, (job) => convertRequest(req, caller, job));
  } catch (error) {
    if (error instanceof CallerJobRefusedError) {
      return callerJobRefusedResponse(error, HTML_TO_PDF_BUSY_MESSAGE);
    }
    if (error instanceof BrowserToolBusyError) {
      return busyResponse(HTML_TO_PDF_BUSY_MESSAGE);
    }
    return handleConvertError(error, 'Failed to convert HTML to PDF.');
  }
}
