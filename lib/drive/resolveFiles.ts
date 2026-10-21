import { ClientError, UpstreamError } from '@/lib/convert/errors';
import type { UploadBudget } from '@/lib/http/read-upload';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]+$/;

// For all the Drive files of one request together, metadata and downloads. The largest
// file any plan accepts is 500 MB, which this allows at a little over 4 MB/s.
export const DRIVE_IMPORT_TIMEOUT_MS = 120_000;

export const INVALID_DRIVE_SELECTION_MESSAGE = 'A Google Drive file selection is invalid. Please choose the file again.';
export const DRIVE_ACCESS_DENIED_MESSAGE =
  'Google Drive would not give access to this file. Please reconnect Google Drive and choose the file again.';
export const DRIVE_UNAVAILABLE_MESSAGE =
  'The file could not be imported because Google Drive is unavailable. Please try again.';
export const DRIVE_TIMEOUT_MESSAGE = 'Importing the file from Google Drive took too long. Please try again.';

interface DriveSelection {
  id: string;
  accessToken: string;
}

interface DriveMetadata {
  name: string;
  size: number | null;
  mimeType: string;
}

function parseSelection(entry: FormDataEntryValue): DriveSelection {
  let selection: unknown = null;
  if (typeof entry === 'string') {
    try {
      selection = JSON.parse(entry);
    } catch {
      selection = null;
    }
  }

  const { id, accessToken } = (selection ?? {}) as Record<string, unknown>;
  if (typeof id !== 'string' || !DRIVE_FILE_ID.test(id) || typeof accessToken !== 'string' || accessToken === '') {
    throw new ClientError(INVALID_DRIVE_SELECTION_MESSAGE);
  }
  return { id, accessToken };
}

function localFiles(formData: FormData, fieldName: string): File[] {
  return formData.getAll(fieldName).map((entry) => {
    if (typeof entry === 'string') {
      throw new ClientError(`The "${fieldName}" field must be a file.`);
    }
    if (entry.name === '') {
      throw new ClientError('Every uploaded file must have a name.');
    }
    return entry;
  });
}

/** Awaits a network step of the import, reporting its failure as Drive's, not the server's. */
async function fromDrive<T>(step: Promise<T>): Promise<T> {
  try {
    return await step;
  } catch (error) {
    // AbortSignal.timeout rejects with a DOMException, which is not an Error in every realm.
    if ((error as { name?: unknown } | null)?.name === 'TimeoutError') {
      throw new UpstreamError(DRIVE_TIMEOUT_MESSAGE, 504, { cause: error });
    }
    throw new UpstreamError(DRIVE_UNAVAILABLE_MESSAGE, 502, { cause: error });
  }
}

function failedDriveResponse(res: Response): Error {
  // Drive answers a malformed request with 400, an expired token with 401 and a file the
  // token may not open with 403 or 404: all of them mean the selection must be redone.
  if ([400, 401, 403, 404].includes(res.status)) {
    return new ClientError(DRIVE_ACCESS_DENIED_MESSAGE);
  }
  return new UpstreamError(DRIVE_UNAVAILABLE_MESSAGE, 502, { cause: new Error(`Google Drive returned ${res.status}`) });
}

async function driveFetch(url: string, selection: DriveSelection, signal: AbortSignal): Promise<Response> {
  const res = await fromDrive(fetch(url, { headers: { Authorization: `Bearer ${selection.accessToken}` }, signal }));
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw failedDriveResponse(res);
  }
  return res;
}

function fileUrl(selection: DriveSelection, query: string): string {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(selection.id)}?${query}&supportsAllDrives=true`;
}

async function fetchMetadata(selection: DriveSelection, signal: AbortSignal): Promise<DriveMetadata> {
  const res = await driveFetch(fileUrl(selection, 'fields=name,size,mimeType'), selection, signal);
  const metadata = ((await fromDrive(res.json())) ?? {}) as Record<string, unknown>;

  // Drive reports sizes as decimal strings, and none at all for Google Docs files.
  const size = typeof metadata.size === 'string' && /^\d+$/.test(metadata.size) ? Number(metadata.size) : null;
  return {
    name: typeof metadata.name === 'string' && metadata.name !== '' ? metadata.name : 'Google Drive file',
    size,
    mimeType: typeof metadata.mimeType === 'string' ? metadata.mimeType : 'application/octet-stream',
  };
}

async function downloadWithin(
  selection: DriveSelection,
  maxBytes: number,
  budget: UploadBudget,
  signal: AbortSignal,
): Promise<Uint8Array[]> {
  const res = await driveFetch(fileUrl(selection, 'alt=media'), selection, signal);

  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw budget.tooLarge(declared);
  }

  const chunks: Uint8Array[] = [];
  if (!res.body) return chunks;

  const reader = res.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await fromDrive(reader.read());
    if (done) return chunks;

    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw budget.tooLarge();
    }
    chunks.push(value);
  }
}

async function importDriveFile(
  selection: DriveSelection,
  maxBytes: number,
  budget: UploadBudget,
  signal: AbortSignal,
): Promise<File> {
  const metadata = await fetchMetadata(selection, signal);
  if (metadata.size !== null && metadata.size > maxBytes) {
    throw budget.tooLarge(metadata.size);
  }

  const chunks = await downloadWithin(selection, maxBytes, budget, signal);
  return new File(chunks as BlobPart[], metadata.name, { type: metadata.mimeType });
}

/**
 * The files uploaded under `fieldName` followed by the Google Drive files the form
 * selects. The Drive files share `budget` with the uploaded ones: each one's size is read
 * from Drive before it is downloaded, and the download is cut off once it passes what
 * the files before it left. The name and type come from Drive, not from the form.
 */
export async function resolveFiles(formData: FormData, fieldName: string, budget: UploadBudget): Promise<File[]> {
  const files = localFiles(formData, fieldName);
  const selections = formData.getAll('googleDriveFiles').map(parseSelection);
  if (selections.length === 0) return files;

  let remaining = budget.maxBytes - files.reduce((total, file) => total + file.size, 0);
  if (remaining < 0) {
    throw budget.tooLarge();
  }

  const signal = AbortSignal.timeout(DRIVE_IMPORT_TIMEOUT_MS);
  for (const selection of selections) {
    const file = await importDriveFile(selection, remaining, budget, signal);
    remaining -= file.size;
    files.push(file);
  }
  return files;
}
