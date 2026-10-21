// Long enough for any real file name; a longer one would only bloat the header, which
// proxies limit, since every non-ASCII character takes up to 12 bytes once encoded.
const MAX_NAME_CHARACTERS = 200;

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f]/g;
// A Drive name is JSON, which can carry half of a surrogate pair; encodeURIComponent
// throws on one.
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const UNSAFE_IN_QUOTED_ASCII = /[^\x20-\x7e]|["\\]/gu;

function truncateKeepingExtension(name: string): string {
  const characters = Array.from(name);
  if (characters.length <= MAX_NAME_CHARACTERS) return name;

  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? Array.from(name.slice(dot)) : [];
  const keptExtension = extension.length < MAX_NAME_CHARACTERS / 2 ? extension : [];
  return characters.slice(0, MAX_NAME_CHARACTERS - keptExtension.length).join('') + keptExtension.join('');
}

// RFC 5987 attr-char: what encodeURIComponent leaves alone, less ' ( ) *.
function encodeExtValue(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * An `attachment` Content-Disposition header (RFC 6266) naming the download `fileName`,
 * or `fallbackName` when nothing of it is left. Browsers take the name from the
 * percent-encoded UTF-8 `filename*`; the quoted `filename` is an ASCII-only stand-in for
 * clients that do not read it, so no name can break the header or add parameters to it.
 */
export function attachmentDisposition(fileName: string, fallbackName: string): string {
  const cleaned = truncateKeepingExtension(
    String(fileName ?? '').replace(LONE_SURROGATES, '�').replace(CONTROL_CHARACTERS, '').trim(),
  );
  const name = cleaned === '' ? fallbackName : cleaned;
  const asciiName = name.replace(UNSAFE_IN_QUOTED_ASCII, '_');
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeExtValue(name)}`;
}
