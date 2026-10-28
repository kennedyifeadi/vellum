import {
  admitFiles,
  dropZoneLabel,
  dropZoneMaxBytes,
  largestUploadBytes,
  planName,
  selectionError,
  uploadLimitLabel,
} from '@/lib/upload-limits';

const MB = 1024 * 1024;

function file(name: string, sizeMb: number) {
  return { name, size: sizeMb * MB };
}

describe('planName', () => {
  it.each([
    [undefined, 'Free'],
    ['Free', 'Free'],
    ['something-else', 'Free'],
    ['Basic', 'Basic'],
    ['Pro', 'Pro'],
    ['Enterprise', 'Enterprise'],
  ])('%p is %s', (plan, name) => {
    expect(planName(plan)).toBe(name);
  });
});

describe('uploadLimitLabel', () => {
  it.each([
    ['pdf-to-docx', 'Free', 'Free plan: up to 5 MB and 100 pages per file'],
    ['pdf-to-docx', 'Enterprise', 'Enterprise plan: up to 25 MB and 500 pages per file'],
    ['compress-pdf', 'Free', 'Free plan: up to 25 MB per file'],
    ['compress-pdf', 'Pro', 'Pro plan: up to 100 MB per file'],
    ['find-pdf', 'Basic', 'Basic plan: up to 50 MB and 50 pages per file'],
    ['image-compress', 'Free', 'Free plan: up to 3 files, 25 MB in total'],
    ['image-compress', 'Enterprise', 'Enterprise plan: up to 100 files, 200 MB in total'],
    ['merge-pdf', 'Enterprise', 'Enterprise plan: up to 100 files, 250 MB in total'],
    ['video-compress', 'Pro', 'Pro plan: up to 500 MB per file'],
  ])('%s on %s', (tool, plan, label) => {
    expect(uploadLimitLabel(tool, plan)).toBe(label);
  });

  it('is generic when no tool is chosen', () => {
    expect(uploadLimitLabel('', 'Pro')).toBe('Limits depend on the tool you choose');
  });
});

describe('admitFiles', () => {
  it('turns away a PDF over PDF to Word’s lower cap for a guest, though other PDF tools take it', () => {
    const pdf = file('report.pdf', 6);

    const toWord = admitFiles([], [pdf], 'pdf-to-docx', 'PDF to DOCX', 'Free');
    const compress = admitFiles([], [pdf], 'compress-pdf', 'Compress PDF', 'Free');

    expect(toWord).toEqual({
      files: [],
      error: '"report.pdf" is larger than PDF to DOCX allows on the Free plan (5 MB per file).',
    });
    expect(compress).toEqual({ files: [pdf], error: null });
  });

  it('accepts a file exactly at the cap', () => {
    expect(admitFiles([], [file('a.pdf', 15)], 'pdf-to-docx', 'PDF to DOCX', 'Pro').error).toBeNull();
    expect(admitFiles([], [file('a.pdf', 15.01)], 'pdf-to-docx', 'PDF to DOCX', 'Pro').error).not.toBeNull();
  });

  it('gives Enterprise its own caps rather than the guest’s', () => {
    expect(admitFiles([], [file('big.pdf', 200)], 'compress-pdf', 'Compress PDF', 'Enterprise').error).toBeNull();
    expect(admitFiles([], [file('big.pdf', 200.01)], 'compress-pdf', 'Compress PDF', 'Enterprise').error).not.toBeNull();
    expect(admitFiles([], [file('big.pdf', 200)], 'compress-pdf', 'Compress PDF', 'Free').error).not.toBeNull();
  });

  it('checks Compress Image against the total of the request, not each image', () => {
    const images = [file('a.jpg', 10), file('b.jpg', 10), file('c.jpg', 10)];

    const result = admitFiles([], images, 'image-compress', 'Compress Image', 'Free');

    expect(result.files).toEqual(images.slice(0, 2));
    expect(result.error).toBe('These files are larger in total than Compress Image allows on the Free plan (25 MB in total).');
  });

  it('stops at the plan’s file count', () => {
    const images = ['a', 'b', 'c', 'd'].map((name) => file(`${name}.jpg`, 1));

    const result = admitFiles([], images, 'image-compress', 'Compress Image', 'Free');

    expect(result.files).toHaveLength(3);
    expect(result.error).toBe('Compress Image takes up to 3 files on the Free plan.');
  });

  it('takes one file at a time for a single-file tool', () => {
    const result = admitFiles([file('a.pdf', 1)], [file('b.pdf', 1)], 'lock-pdf', 'Lock PDF', 'Pro');

    expect(result.files).toHaveLength(1);
    expect(result.error).toBe('This tool only supports processing 1 file at a time.');
  });

  it('skips a file already chosen without an error', () => {
    const a = file('a.jpg', 1);

    expect(admitFiles([a], [a], 'image-to-pdf', 'Image to PDF', 'Basic')).toEqual({ files: [a], error: null });
  });

  it('keeps the files before the first refusal and reports only that refusal', () => {
    const result = admitFiles([], [file('ok.pdf', 1), file('huge.pdf', 30)], 'compress-pdf', 'Compress PDF', 'Free');

    expect(result.files).toEqual([file('ok.pdf', 1)]);
    expect(result.error).toContain('huge.pdf');
  });

  it('with no tool chosen, allows anything some tool takes on the plan', () => {
    expect(largestUploadBytes('Free')).toBe(50 * MB);
    expect(admitFiles([], [file('clip.mp4', 50)], '', 'This tool', 'Free').error).toBeNull();
    expect(admitFiles([], [file('clip.mp4', 51)], '', 'This tool', 'Free').error).toBe(
      '"clip.mp4" is larger than any tool allows on the Free plan (50 MB).',
    );
  });

  it('adds nothing for an empty selection', () => {
    expect(admitFiles([], [], 'merge-pdf', 'Merge PDF', 'Pro')).toEqual({ files: [], error: null });
  });
});

describe('selectionError', () => {
  it('catches a file added before the tool was chosen', () => {
    const files = [file('report.pdf', 20)];

    expect(admitFiles([], files, '', 'This tool', 'Free').error).toBeNull();
    expect(selectionError(files, 'pdf-to-docx', 'PDF to DOCX', 'Free')).toContain('5 MB per file');
  });

  it('is null for a sendable selection', () => {
    expect(selectionError([file('a.pdf', 1), file('b.pdf', 1)], 'merge-pdf', 'Merge PDF', 'Free')).toBeNull();
  });
});

describe('drop zone', () => {
  it.each([
    ['Free', 25],
    ['Basic', 50],
    ['Pro', 100],
    ['Enterprise', 200],
  ])('on %s takes up to %i MB', (plan, mb) => {
    expect(dropZoneMaxBytes(plan)).toBe(mb * MB);
    expect(dropZoneLabel(plan)).toBe(`Max file size ${mb} MB on the ${plan} plan; some tools allow less.`);
  });
});
