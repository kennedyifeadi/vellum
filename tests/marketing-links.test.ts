import fs from 'fs';
import path from 'path';
import { ALL_TOOLS } from '@/lib/tools';
import { toolPath } from '@/lib/solutions-pages';

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

const DYNAMIC_SEGMENT = /^\[([^.\]]+)\]$/;

/** A page route's URL segments, with route groups dropped, and the values each dynamic one takes. */
interface PageRoute {
  segments: string[];
  values: Map<string, Set<string>>;
}

type DynamicPage = { generateStaticParams?: () => Record<string, string>[] | Promise<Record<string, string>[]> };

// A dynamic segment resolves only to the values its page's generateStaticParams lists. A dynamic
// page without one could answer any value, so a link to it cannot be checked and counts as broken.
async function pageRoutes(): Promise<PageRoute[]> {
  const pages = listSourceFiles('app').filter((file) => path.basename(file) === 'page.tsx');
  return Promise.all(
    pages.map(async (file) => {
      const segments = path
        .relative(path.join(ROOT, 'app'), path.dirname(file))
        .split(path.sep)
        .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment));
      const values = new Map<string, Set<string>>();
      if (segments.some((segment) => DYNAMIC_SEGMENT.test(segment))) {
        const page: DynamicPage = await import(file);
        const params = (await page.generateStaticParams?.()) ?? [];
        for (const segment of segments) {
          const name = DYNAMIC_SEGMENT.exec(segment)?.[1];
          if (name) values.set(segment, new Set(params.map((param) => param[name])));
        }
      }
      return { segments, values };
    }),
  );
}

function isPageRoute(pathname: string, routes: PageRoute[]): boolean {
  const parts = pathname.split('/').filter(Boolean);
  return routes.some(
    ({ segments, values }) =>
      segments.length === parts.length &&
      segments.every((segment, i) => values.get(segment)?.has(parts[i]) ?? segment === parts[i]),
  );
}

interface FoundLink {
  file: string;
  value: string;
}

// A tool page's link is built with toolPath. A quoted id is checked as written; `<tool>.id`
// stands for every tool in lib/tools.tsx, the list the Solutions pages are built from.
function toolPathLinks(argument: string): string[] | null {
  const quoted = /^(?:"([^"]*)"|'([^']*)')$/.exec(argument);
  if (quoted) return [toolPath(quoted[1] ?? quoted[2])];
  if (/^\w+\.id$/.test(argument)) return ALL_TOOLS.map((tool) => toolPath(tool.id));
  return null;
}

function linksInSource(source: string, relative: string): { links: FoundLink[]; dynamic: string[] } {
  const links: FoundLink[] = [];
  const dynamic: string[] = [];

  for (const match of source.matchAll(/\bhref=(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^}]*))\s*\})/g)) {
    const [, dq, sq, bdq, bsq, template, expression] = match;
    const literal = dq ?? sq ?? bdq ?? bsq ?? template;
    const toolCall = expression === undefined ? null : /^toolPath\((.*)\)$/.exec(expression.trim());
    const toolLinks = toolCall ? toolPathLinks(toolCall[1].trim()) : null;
    if (literal !== undefined && !literal.includes('${')) {
      links.push({ file: relative, value: literal });
    } else if (toolLinks) {
      links.push(...toolLinks.map((value) => ({ file: relative, value })));
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

function linksIn(file: string) {
  return linksInSource(fs.readFileSync(file, 'utf8'), path.relative(ROOT, file));
}

function brokenLink(value: string, routes: PageRoute[]): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return true;
  return !isPageRoute(value.split(/[?#]/)[0], routes);
}

const files = MARKETING_SOURCES.flatMap(listSourceFiles);
const scanned = files.map(linksIn);
const allLinks = scanned.flatMap((result) => result.links);

describe('marketing links', () => {
  let routes: PageRoute[];
  beforeAll(async () => {
    routes = await pageRoutes();
  }, 60_000);

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

  it('checks a tool link built with toolPath against the tool pages', () => {
    const one = linksInSource('<Link href={toolPath("merge-pdf")} />', 'x.tsx');
    expect(one).toEqual({ links: [{ file: 'x.tsx', value: '/solutions/merge-pdf' }], dynamic: [] });

    const missing = linksInSource("<Link href={toolPath('not-a-tool')} />", 'x.tsx').links[0].value;
    expect(brokenLink(missing, routes)).toBe(true);

    const everyTool = linksInSource('<Link href={toolPath(tool.id)} />', 'x.tsx').links.map((link) => link.value);
    expect(everyTool).toEqual(ALL_TOOLS.map((tool) => `/solutions/${tool.id}`));
    expect(everyTool.filter((value) => brokenLink(value, routes))).toEqual([]);

    expect(linksInSource('<Link href={toolPath(someId)} />', 'x.tsx').dynamic).toEqual(['x.tsx: href={toolPath(someId)}']);
  });

  it('resolves a dynamic page only to the values it generates', () => {
    const generated: PageRoute = { segments: ['solutions', '[tool]'], values: new Map([['[tool]', new Set(['merge-pdf'])]]) };
    expect(isPageRoute('/solutions/merge-pdf', [generated])).toBe(true);
    expect(isPageRoute('/solutions/split-pdf', [generated])).toBe(false);

    const ungenerated: PageRoute = { segments: ['docs', '[slug]'], values: new Map([['[slug]', new Set()]]) };
    expect(isPageRoute('/docs/anything', [ungenerated])).toBe(false);
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
    ['lossless image compression, which is lossy', /without quality loss/i],
    ['video compression that keeps the quality', /while preserving quality/i],
    ['instant PDF compression', /file size instantly/i],
  ])('no longer claims %s', (_claim, pattern) => {
    expect(filesContaining(pattern)).toEqual([]);
  });
});
