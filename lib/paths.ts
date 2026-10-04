import path from 'path';

/**
 * Returns the resolved form of `candidate`, throwing unless it is strictly inside `dir`.
 * Call it on every path built from a value the server did not generate itself.
 */
export function assertInsideDir(dir: string, candidate: string): string {
  const root = path.resolve(dir);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);

  const escapes =
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);

  if (escapes) {
    throw new Error(`Refusing to use a path outside ${root}`);
  }
  return resolved;
}

const SEPARATORS = /[\\/:]/;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/g;

/**
 * Reduces a client-supplied file name to its final segment. Splits on both separator
 * styles (and the Windows drive colon) regardless of the host OS, because the name is
 * interpreted by whoever receives it, not by this server.
 */
export function bareFileName(name: string, fallback: string): string {
  const lastSegment = String(name ?? '').split(SEPARATORS).pop() ?? '';
  const cleaned = lastSegment.replace(CONTROL_CHARACTERS, '').trim();
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? fallback : cleaned;
}

/**
 * Returns `name`, or `name (n)` when it is already in `taken`, and records the result.
 * Comparison is case-insensitive so entries don't overwrite each other when extracted
 * onto a case-insensitive filesystem.
 */
export function claimUniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  let candidate = name;
  for (let n = 1; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${stem} (${n})${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
