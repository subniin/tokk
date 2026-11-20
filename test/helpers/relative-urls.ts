// Relative-URL scan of the site (Task 21, requirement 7). Shared by test/build-site.test.ts and the landing check.
// A regular-expression scan on text, not a parser. It guards against accidents. Every bad form has a sample in the test.

const BAD_SCHEME = /(?:^|[^a-z])(?:https?|wss?|file):/i;
const URL_ATTRIBUTES = ['href', 'src', 'action', 'poster', 'srcset'];

function isBadValue(value: string): boolean {
  const v = value.trim();
  return v.startsWith('/') || BAD_SCHEME.test(v);
}

// HTML: attribute values and import map values.
export function scanHtml(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    for (const a of attrs.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const name = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? '';
      if (URL_ATTRIBUTES.includes(name)) {
        const inline = /^(?:data|blob):/i.test(value.trim());
        if (inline && tag === 'script') found.push(`<${tag} ${name}="${value}"> (data: or blob: in a script)`);
        else if (!inline && (name === 'srcset' ? value.split(',').some((part) => isBadValue(part.trim().split(/\s+/)[0] ?? '')) : isBadValue(value))) {
          found.push(`<${tag} ${name}="${value}">`);
        }
      } else if (name === 'content' && /url\s*=/i.test(value) && isBadValue(value.slice(value.toLowerCase().indexOf('url=') + 4))) {
        found.push(`<${tag} content="${value}"> (refresh)`);
      }
    }
  }
  for (const m of text.matchAll(/<script\b[^>]*type\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const walk = (x: unknown): void => {
      if (typeof x === 'string') { if (isBadValue(x)) found.push(`import map value "${x}"`); }
      else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    };
    try { walk(JSON.parse(m[1])); } catch { found.push('import map is not valid JSON'); }
  }
  return found;
}

const BAD_START = (v: string): boolean => v.startsWith('/') || v.includes('localhost');
const STRING_CALLS: [string, RegExp][] = [
  ['url()', /\burl\(\s*(["'`]?)([^"'`)]*)\1\s*\)/g],
  ['@import', /@import\s*(?:url\(\s*)?(["'`])([^"'`]*)\1/g],
  ['import from', /\bfrom\s*(["'`])([^"'`]*)\1/g],
  ['import ""', /\bimport\s*(["'`])([^"'`]*)\1/g],
  ['import()', /\bimport\s*\(\s*(["'`])([^"'`]*)\1/g],
  ['fetch()', /\bfetch\s*\(\s*(["'`])([^"'`]*)\1/g],
  ['new Worker()', /\bnew\s+Worker\s*\(\s*(["'`])([^"'`]*)\1/g],
  ['new URL()', /\bnew\s+URL\s*\(\s*(["'`])([^"'`]*)\1/g],
];

// CSS and JS: the first argument of each call, when it is a string literal.
export function scanScriptOrCss(text: string): string[] {
  const found: string[] = [];
  for (const [label, re] of STRING_CALLS) {
    for (const m of text.matchAll(re)) {
      if (BAD_START(m[2])) found.push(`${label} "${m[2]}"`);
    }
  }
  return found;
}

// Returns "file: match" lines for a site file, by extension. Other extensions are not scanned.
export function scanSiteFile(path: string, text: string): string[] {
  const lower = path.toLowerCase();
  const matches = lower.endsWith('.html') ? [...scanHtml(text), ...scanInlineModules(text)]
    : lower.endsWith('.js') || lower.endsWith('.css') ? scanScriptOrCss(text) : [];
  return matches.map((x) => `${path}: ${x}`);
}

// Inline <script> bodies of an html file are scanned like a .js file.
function scanInlineModules(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) out.push(...scanScriptOrCss(m[1]));
  return out;
}

// The href values of a page, in order. Used by the landing check and by test S4.
export function hrefsOf(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
}
