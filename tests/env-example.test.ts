import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['app', 'lib', 'components', 'models'];
const SOURCE_FILES = ['proxy.ts', 'next.config.ts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
// Set by Next.js and Node themselves, never by whoever configures the app.
const RUNTIME_PROVIDED = new Set(['NODE_ENV']);

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

function variablesReadBySource(): string[] {
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => listSourceFiles(path.join(ROOT, dir))),
    ...SOURCE_FILES.map((file) => path.join(ROOT, file)),
  ];
  const names = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      names.add(match[1]);
    }
  }
  return [...names].filter((name) => !RUNTIME_PROVIDED.has(name)).sort();
}

function variablesListedInExample(): string[] {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const names = [...example.matchAll(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
  return names.sort();
}

describe('.env.example', () => {
  it('lists exactly the variables the source reads, each once', () => {
    expect(variablesListedInExample()).toEqual(variablesReadBySource());
  });

  it('does not ask for NODE_ENV to be set', () => {
    expect(variablesListedInExample()).not.toContain('NODE_ENV');
  });
});
