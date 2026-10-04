import os from 'os';
import path from 'path';
import { assertInsideDir, bareFileName, claimUniqueName } from '@/lib/paths';

describe('assertInsideDir', () => {
  const root = path.join(os.tmpdir(), 'vellum-paths-test');

  it('returns the resolved path for a file inside the directory', () => {
    expect(assertInsideDir(root, path.join(root, 'a.mp4'))).toBe(path.resolve(root, 'a.mp4'));
    expect(assertInsideDir(root, path.join(root, 'docs', 'a.pdf'))).toBe(path.resolve(root, 'docs', 'a.pdf'));
  });

  it('accepts a name that merely starts with dots', () => {
    expect(assertInsideDir(root, path.join(root, '..hidden'))).toBe(path.resolve(root, '..hidden'));
  });

  it.each([
    ['a parent traversal', path.join(root, '..', 'x.mp4')],
    ['a deep traversal', path.join(root, '..', '..', '..', 'x.mp4')],
    ['a traversal hidden behind a real segment', path.join(root, 'docs', '..', '..', 'x.mp4')],
    ['the parent directory', path.dirname(root)],
    ['the directory itself', root],
    ['a sibling sharing the directory name as a prefix', `${root}-evil${path.sep}x.mp4`],
    ['an unrelated absolute path', path.resolve(os.homedir(), 'x.mp4')],
  ])('throws for %s', (_label, candidate) => {
    expect(() => assertInsideDir(root, candidate)).toThrow(/outside/);
  });
});

describe('bareFileName', () => {
  it.each([
    ['photo.png', 'photo.png'],
    ['../../x.png', 'x.png'],
    ['..\\..\\x.png', 'x.png'],
    ['/etc/passwd', 'passwd'],
    ['C:\\Windows\\win.ini', 'win.ini'],
    ['C:evil.png', 'evil.png'],
    ['a/b\\c/photo.png', 'photo.png'],
    ['line\r\nbreak.png', 'linebreak.png'],
  ])('reduces %j to %j', (input, expected) => {
    expect(bareFileName(input, 'fallback')).toBe(expected);
  });

  it.each(['', '.', '..', '/', '\\', '/\\/\\', '../..', 'dir/', '   '])(
    'falls back when %j has no usable final segment',
    (input) => {
      expect(bareFileName(input, 'fallback')).toBe('fallback');
    },
  );
});

describe('claimUniqueName', () => {
  it('returns the name unchanged the first time and numbers later collisions', () => {
    const taken = new Set<string>();

    expect(claimUniqueName('a.png', taken)).toBe('a.png');
    expect(claimUniqueName('a.png', taken)).toBe('a (1).png');
    expect(claimUniqueName('a.png', taken)).toBe('a (2).png');
    expect(claimUniqueName('b.png', taken)).toBe('b.png');
  });

  it('treats names differing only by case as a collision', () => {
    const taken = new Set<string>();

    expect(claimUniqueName('Photo.PNG', taken)).toBe('Photo.PNG');
    expect(claimUniqueName('photo.png', taken)).toBe('photo (1).png');
  });

  it('numbers names that have no extension', () => {
    const taken = new Set<string>();

    expect(claimUniqueName('README', taken)).toBe('README');
    expect(claimUniqueName('README', taken)).toBe('README (1)');
    expect(claimUniqueName('.env', taken)).toBe('.env');
    expect(claimUniqueName('.env', taken)).toBe('.env (1)');
  });
});
