import { attachmentDisposition, fileNameFromDisposition } from '@/lib/http/content-disposition';

describe('attachmentDisposition', () => {
  it.each([
    ['plain ASCII', 'report.pdf', `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`],
    ['spaces', 'my report.pdf', `attachment; filename="my report.pdf"; filename*=UTF-8''my%20report.pdf`],
    ['accents', 'résumé.pdf', `attachment; filename="r_sum_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`],
    ['CJK', '报告.pdf', `attachment; filename="__.pdf"; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf`],
    ['emoji', '😀.pdf', `attachment; filename="_.pdf"; filename*=UTF-8''%F0%9F%98%80.pdf`],
    ['a double quote', 'a"b.pdf', `attachment; filename="a_b.pdf"; filename*=UTF-8''a%22b.pdf`],
    ['a backslash', 'a\\b.pdf', `attachment; filename="a_b.pdf"; filename*=UTF-8''a%5Cb.pdf`],
    ['CR/LF', 'a\r\nb.pdf', `attachment; filename="ab.pdf"; filename*=UTF-8''ab.pdf`],
    ['NUL', 'a\u0000b.pdf', `attachment; filename="ab.pdf"; filename*=UTF-8''ab.pdf`],
    ["RFC 5987's reserved characters", "it's (1)*.pdf", `attachment; filename="it's (1)*.pdf"; filename*=UTF-8''it%27s%20%281%29%2A.pdf`],
    ['a lone surrogate', 'a\uD800b.pdf', `attachment; filename="a_b.pdf"; filename*=UTF-8''a%EF%BF%BDb.pdf`],
  ])('names a file with %s', (_label, name, expected) => {
    expect(attachmentDisposition(name, 'download')).toBe(expected);
  });

  it('cannot be made to carry another parameter', () => {
    const header = attachmentDisposition(`a".pdf"; filename*=UTF-8''evil.exe; x="`, 'download');

    expect(header).toBe(
      `attachment; filename="a_.pdf_; filename*=UTF-8''evil.exe; x=_"; filename*=UTF-8''a%22.pdf%22%3B%20filename%2A%3DUTF-8%27%27evil.exe%3B%20x%3D%22`,
    );
    expect(() => new Headers({ 'content-disposition': header })).not.toThrow();
  });

  it.each([
    ['an empty name', ''],
    ['only whitespace', '   '],
    ['only control characters', '\r\n\u0000'],
  ])('falls back for %s', (_label, name) => {
    expect(attachmentDisposition(name, 'converted.pdf')).toBe(
      `attachment; filename="converted.pdf"; filename*=UTF-8''converted.pdf`,
    );
  });

  it('shortens a very long name and keeps its extension', () => {
    const header = attachmentDisposition(`${'长'.repeat(500)}.docx`, 'download');
    const name = decodeURIComponent(header.split("filename*=UTF-8''")[1]);

    expect(Array.from(name)).toHaveLength(200);
    expect(name.endsWith('.docx')).toBe(true);
  });

  it('never splits an emoji when shortening', () => {
    const header = attachmentDisposition('😀'.repeat(300), 'download');
    const name = decodeURIComponent(header.split("filename*=UTF-8''")[1]);

    expect(name).toBe('😀'.repeat(200));
  });

  it('produces a header Node accepts for every class of name', () => {
    for (const name of ['报告.pdf', '😀', 'a"b', 'a\r\nb', '\u0000', 'é'.repeat(1000)]) {
      expect(() => new Headers({ 'content-disposition': attachmentDisposition(name, 'download') })).not.toThrow();
    }
  });
});

describe('fileNameFromDisposition', () => {
  it.each([
    ['an ASCII name', 'report.pdf'],
    ['spaces', 'my report.pdf'],
    ['accents', 'résumé.pdf'],
    ['CJK', '报告.pdf'],
    ['emoji', '😀.pdf'],
    ["RFC 5987's reserved characters", "it's (1)*.pdf"],
  ])('reads back the name attachmentDisposition wrote, with %s', (_label, name) => {
    expect(fileNameFromDisposition(attachmentDisposition(name, 'download'))).toBe(name);
  });

  it('prefers filename* to filename, wherever each appears', () => {
    expect(fileNameFromDisposition(`attachment; filename*=UTF-8''%E6%97%85.mp4; filename="_.mp4"`)).toBe('旅.mp4');
    expect(fileNameFromDisposition(`ATTACHMENT; FILENAME="_.mp4"; FILENAME*=utf-8'en'%E6%97%85.mp4`)).toBe('旅.mp4');
  });

  it.each([
    ['a quoted filename', 'attachment; filename="clip.mp4"', 'clip.mp4'],
    ['an unquoted filename', 'attachment; filename=clip.mp4', 'clip.mp4'],
    ['escapes in a quoted filename', 'attachment; filename="a\\"b.mp4"', 'a"b.mp4'],
    ['filename* that is not percent-encoded UTF-8', `attachment; filename*=UTF-8''%E6%97; filename="x.mp4"`, 'x.mp4'],
    ['filename* in another charset', `attachment; filename*=ISO-8859-1''caf%E9.mp4; filename="cafe.mp4"`, 'cafe.mp4'],
  ])('falls back to filename for %s', (_label, header, expected) => {
    expect(fileNameFromDisposition(header)).toBe(expected);
  });

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['no file name', 'attachment'],
    ['an empty file name', 'attachment; filename=""'],
    ['only an unreadable filename*', `attachment; filename*=UTF-8''%ZZ`],
  ])('gives null for %s', (_label, header) => {
    expect(fileNameFromDisposition(header)).toBeNull();
  });
});
