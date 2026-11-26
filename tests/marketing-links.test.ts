import fs from 'fs';
import path from 'path';
import { ALL_TOOLS } from '@/lib/tools';

const ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

// The pages a visitor reaches before signing in, and the chrome around them.
const MARKETING_SOURCES = [
  'app/(marketing)',
  'components/marketing',
  'components/shared/Navbar.tsx',
  'components/shared/Footer.tsx',
  'app/(auth)/login/page.tsx',
  'app/(auth)/signup-details/page.tsx',
];

// A link held in a variable is checked where the variable's value is written, as one of
// these object properties.
const LINK_PROPERTIES = ['href', 'buttonLink', 'link'];

function listSourceFiles(entry: string): string[] {
  const entryPath = path.join(ROOT, entry);
  if (fs.statSync(entryPath).isFile()) return [entryPath];
  return fs.readdirSync(entryPath, { withFileTypes: true }).flatMap((child) => {
    const childPath = path.join(entry, child.name);
    if (child.isDirectory()) return listSourceFiles(childPath);
    return SOURCE_EXTENSIONS.has(path.extname(child.name)) ? [path.join(ROOT, childPath)] : [];
  });
}

/** Each page route under app/ as its URL segments, with route groups dropped. */
function pageRoutes(): string[][] {
  return listSourceFiles('app')
    .filter((file) => path.basename(file) === 'page.tsx')
    .map((file) =>
      path
        .relative(path.join(ROOT, 'app'), path.dirname(file))
        .split(path.sep)
        .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment)),
    );
}

function isPageRoute(pathname: string, routes: string[][]): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return routes.some(
    (route) =>
      route.length === segments.length &&
      route.every((part, i) => /^\[[^.\]]+\]$/.test(part) || part === segments[i]),
  );
}

// The tool sheets live at /solutions/<tool id>, which may land before or after these pages.
function isToolSheet(pathname: string): boolean {
  const match = /^\/solutions\/([^/]+)$/.exec(pathname);
  return !!match && ALL_TOOLS.some((tool) => tool.id === match[1]);
}

interface FoundLink {
  file: string;
  value: string;
}

function linksIn(file: string): { links: FoundLink[]; dynamic: string[] } {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(ROOT, file);
  const links: FoundLink[] = [];
  const dynamic: string[] = [];

  for (const match of source.matchAll(/\bhref=(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^}]*))\s*\})/g)) {
    const [, dq, sq, bdq, bsq, template, expression] = match;
    const literal = dq ?? sq ?? bdq ?? bsq ?? template;
    if (literal !== undefined && !literal.includes('${')) {
      links.push({ file: relative, value: literal });
    } else if (literal !== undefined || !/^[\w.]+$/.test(expression.trim())) {
      dynamic.push(`${relative}: href=${match[0].slice(5)}`);
    } else if (!LINK_PROPERTIES.includes(expression.trim().split('.').pop()!)) {
      dynamic.push(`${relative}: href=${match[0].slice(5)}`);
    }
  }

  const property = new RegExp(`\\b(?:${LINK_PROPERTIES.join('|')})\\s*:\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)`, 'g');
  for (const match of source.matchAll(property)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value.includes('${')) dynamic.push(`${relative}: ${match[0]}`);
    else links.push({ file: relative, value });
  }

  return { links, dynamic };
}

function brokenLink(value: string, routes: string[][]): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return true;
  const pathname = value.split(/[?#]/)[0];
  return !isPageRoute(pathname, routes) && !isToolSheet(pathname);
}

const files = MARKETING_SOURCES.flatMap(listSourceFiles);
const scanned = files.map(linksIn);
const allLinks = scanned.flatMap((result) => result.links);

describe('marketing links', () => {
  const routes = pageRoutes();

  it('finds the links it checks', () => {
    for (const file of ['components/shared/Navbar.tsx', 'components/shared/Footer.tsx', 'app/(marketing)/pricing/page.tsx']) {
      expect(allLinks.some((link) => link.file === path.normalize(file))).toBe(true);
    }
  });

  it('builds no link it cannot check', () => {
    expect(scanned.flatMap((result) => result.dynamic)).toEqual([]);
  });

  it('links only to pages that exist', () => {
    const broken = allLinks.filter((link) => brokenLink(link.value, routes)).map((link) => `${link.file}: ${link.value}`);
    expect(broken).toEqual([]);
  });

  it('allows a tool sheet only for a real tool', () => {
    expect(brokenLink('/solutions/pdf-to-docx', routes)).toBe(false);
    expect(brokenLink('/solutions/not-a-tool', routes)).toBe(true);
    expect(brokenLink('/pricing?plan=pro', routes)).toBe(false);
    expect(brokenLink('/signup', routes)).toBe(true);
    expect(brokenLink('#', routes)).toBe(true);
    expect(brokenLink('mailto:someone@example.com', routes)).toBe(true);
  });
});

function sourceFilesUnder(dirs: string[]): string[] {
  return dirs.flatMap(listSourceFiles);
}

describe('marketing copy', () => {
  const sources = sourceFilesUnder(['app', 'components', 'lib']).map((file) => ({
    file: path.relative(ROOT, file),
    text: fs.readFileSync(file, 'utf8'),
  }));

  function filesContaining(pattern: RegExp): string[] {
    return sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
  }

  it('gives no vellum.com address, a domain Vellum does not own', () => {
    expect(filesContaining(/vellum\.com/i)).toEqual([]);
  });

  it.each([
    ['end-to-end encryption', /end-to-end/i],
    ['bank-level encryption', /bank-level/i],
    ['zero lingering data', /zero lingering data/i],
    ['deletion right after download', /deleted immediately after download/i],
    ['SSO', /\bSSO\b/],
    ['an uptime guarantee', /uptime guarantee/i],
    ['API access', /api access/i],
    ['a live system status', /all systems operational/i],
    ['the formatting-retention statistic', /formatting retention/i],
    ['the conversion-time statistic', /average time to convert/i],
    ['the video size statistic', /reduction in file size on average/i],
    ['unlimited merges', /unlimited files per merge/i],
    ['the placeholder street address', /123 Tech Avenue/i],
    ['the template plan description', /personal sites and workflows/i],
    ['links to terms that do not exist', /terms of service/i],
    ['links to a privacy policy that does not exist', /privacy policy/i],
    ['a setup guide that does not exist', /read our guide/i],
  ])('no longer claims %s', (_claim, pattern) => {
    expect(filesContaining(pattern)).toEqual([]);
  });
});
