// Task 35 (run A): the landing page site-src/index.html and its style, read as files. The built output is checked in build-site.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectGroups } from '../scripts/count-wiring';
import { DEMO_STATES, demoView, isDemoState, isTestMode } from '../site-src/src/demo';
import { contrastRatio } from './helpers/contrast';
import { REPO_ROOT } from './web/paths';

// Test-only values.
const GITHUB = 'https://github.com/subniin/tokk';
const KIRO_DOC = `${GITHUB}/blob/main/docs/kiro.md`;
const TEXT_CONTRAST_MIN = 4.5;
const LARGE_CONTRAST_MIN = 3;
const FOCUS_OUTLINE_MIN_PX = 2;
const LINKS = ['#top', '#demo', '#apps', '#build', '#how', GITHUB, GITHUB, '#apps', 'apps/click-talk/', 'apps/shoo/', 'cases/slides/', KIRO_DOC, GITHUB, 'teach.html'];

const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8');
const html = read('site-src/index.html');
const css = read('site-src/style.css');
const main = read('site-src/src/main.ts');

const ENTITIES: Record<string, string> = { '&gt;': '>', '&lt;': '<', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const decode = (s: string): string => s.replace(/&(?:gt|lt|amp|quot|apos|#39);/g, (e) => ENTITIES[e]);
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const textOf = (fragment: string): string => squash(decode(fragment.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ')));
const pageText = textOf(html);
const cardsOf = (): string[] => html.split('<article class="app"').slice(1).map((c) => textOf(c.split('</article>')[0]));

describe('landing page copy (Task 35, site.md section 5)', () => {
  it('has the exact English copy', () => {
    const copy = [
      'Teach a web page a new sound.',
      'Tokk turns claps, knocks and tongue clicks into events your app can use. Teaching takes seconds. Nothing leaves the device.',
      'Use this template', 'See the apps', 'Try it: clap twice',
      'Teach 5 claps, then let it hear the room for 10 seconds.', 'Turn on the microphone', 'Hear a recording',
      'Clap 5 times', '3 of 5 heard', 'Now 10 seconds of the room. Talk or type as usual.', '7 s left',
      'clap clap', 'Heard', 'Clap twice again, or try three times.',
      'Playing a recording. The same engine is listening to it.',
      'The microphone is blocked. Allow it in the address bar, or hear a recording instead.',
      'Two apps, one template.', 'The same engine runs two apps with opposite jobs.',
      'Click Talk', 'Talk with two mouth sounds. For people who cannot speak or use their hands.',
      'Shoo!', 'A Halloween defense game. Every monster runs from one sound.',
      "Added to someone else's app", 'A reveal.js slide deck: clap twice for the next slide, three times to go back.',
      'reveal.js by Hakim El Hattab, MIT licence',
      'Build your own in four steps.', 'Use this template', 'Teach your sounds', 'Map patterns to actions', 'Test with a recording',
      'How it works', 'Microphone', 'AudioWorklet', 'Worker', 'Segments', 'Features', 'Nearest sounds', 'Patterns',
      'A pattern waits while a longer one can still match, then fires at once.',
      'Built with Kiro.', 'Specs', 'Steering', 'Hooks', 'Agents', 'Power', 'How Kiro was used',
      'Audio stays on the device. Tokk keeps feature vectors, not recordings, and sends nothing to a server.',
      'MIT licence', 'GitHub', 'Teach page',
    ];
    for (const c of copy) expect(pageText, c).toContain(c);
    for (const nav of ['Demo', 'Apps', 'Build', 'How it works', 'GitHub']) expect(pageText, nav).toContain(nav);
  });

  it('has one h1, a title, a language, a viewport and the sections in order', () => {
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/<meta name="viewport"/);
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    const order = ['class="nav"', 'id="top"', 'id="demo"', 'id="apps"', 'id="build"', 'id="how"', 'Built with Kiro.', 'class="privacy"', '<footer'];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((i) => i >= 0), order.join(' ')).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('has the six demo states in one stage, idle first', () => {
    for (const cls of ['s-idle', 's-teach', 's-room', 's-live', 's-fail']) expect(html, cls).toContain(`class="st ${cls}"`);
    expect(html).toContain('data-st="idle"');
    expect(html).toContain('class="rec-note"');
    expect(html.match(/<div class="st /g)?.length).toBe(5);
    expect(css).toMatch(/\.stage\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.st\s*\{[^}]*grid-area:\s*1\s*\/\s*1[^}]*visibility:\s*hidden/);
  });
});

describe('landing page links (Task 35)', () => {
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);

  it('has exactly the planned links, and not the old apps', () => {
    expect(hrefs).toEqual(LINKS);
    expect(html).not.toMatch(/hands-free|knock-once/);
  });

  it('every in-page link has a target, and no link is absolute outside the repository on GitHub', () => {
    for (const h of hrefs.filter((x) => x.startsWith('#'))) expect(html, h).toContain(`id="${h.slice(1)}"`);
    for (const h of hrefs.filter((x) => /^[a-z]+:|^\//i.test(x))) expect(h.startsWith(GITHUB), h).toBe(true);
  });
});

describe('landing page has no script, font or request of its own (Task 35)', () => {
  it('loads one module script and one stylesheet from dist/ and has no inline script', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0][1]).toMatch(/type="module"/);
    expect(scripts[0][1]).toMatch(/src="dist\/landing\.js"/);
    expect(scripts[0][2].trim()).toBe('');
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    const links = [...html.matchAll(/<link\b([^>]*)>/gi)].map((m) => m[1]);
    expect(links.filter((l) => /rel="stylesheet"/.test(l))).toHaveLength(1);
    expect(links.join(' ')).toContain('href="dist/landing.css"');
    expect(html).not.toMatch(/<style|<img|<iframe|<object|<embed|<video|<audio|<source/i);
  });

  it('has no external URL except the GitHub links, no @import and no web font', () => {
    const withoutGithub = html.replace(new RegExp(`href="${GITHUB.replace(/[.]/g, '\\.')}[^"]*"`, 'g'), 'href="gh"');
    expect(withoutGithub).not.toMatch(/https?:|\/\/[a-z]/i);
    expect(css).not.toMatch(/https?:|@import|@font-face|url\(\s*["']?(?!data:)/i);
    expect(css).not.toMatch(/googleapis|gstatic|cdn/i);
    const families = [...css.matchAll(/--(sans|mono):\s*([^;]+);/g)].map((m) => m[2]);
    expect(families).toHaveLength(2);
    for (const f of families) expect(f).toMatch(/system-ui|ui-monospace/);
  });

  it('the page code imports nothing but the style and its own files, and sends nothing', () => {
    for (const m of main.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2];
      expect(spec.startsWith('./') || spec.startsWith('../') || spec === 'tokk', spec).toBe(true);
    }
    expect(main).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage/);
  });
});

describe('landing page numbers (Task 35)', () => {
  const groups = collectGroups(REPO_ROOT);
  const lines = (name: string): number => {
    const g = groups.find((x) => x.name === name);
    if (!g) throw new Error(`no wiring group ${name}`);
    return g.lines;
  };
  const integration = read('docs/integration.md');
  const row = (start: string): string => {
    const r = integration.split('\n').find((l) => l.startsWith(start));
    if (!r) throw new Error(`no integration.md row ${start}`);
    return r;
  };
  const hours = (r: string, label: string): string => {
    const m = new RegExp(`${label}:? (\\d+) h (\\d+) min`).exec(r);
    if (!m) throw new Error(`no duration in ${r.slice(0, 60)}`);
    return `${m[1]} h ${m[2]} min`;
  };
  const credits = (r: string): number => {
    const m = /= about (\d+(?:\.\d+)?)/.exec(r);
    if (!m) throw new Error(`no credits in ${r.slice(0, 60)}`);
    return Math.round(Number(m[1]));
  };

  it('the app cards show the wiring lines of count:wiring and the time and credits of integration.md', () => {
    const [clickTalk, shoo] = cardsOf();
    expect(clickTalk).toContain('Click Talk');
    expect(shoo).toContain('Shoo!');
    const ct = row('| Click Talk (task 34)');
    const sh = row('| Shoo! (task 33)');
    expect(lines('apps/click-talk')).toBe(29);
    expect(lines('apps/shoo')).toBe(27);
    expect(clickTalk).toContain(`Wiring ${lines('apps/click-talk')} lines`);
    expect(shoo).toContain(`Wiring ${lines('apps/shoo')} lines`);
    expect(clickTalk).toContain(`Built in ${hours(ct, 'Duration')}`);
    expect(shoo).toContain(`Built in ${hours(sh, 'Duration without task 32b')}`);
    expect(clickTalk).toContain(`about ${credits(ct)} Kiro credits`);
    expect(shoo).toContain(`about ${credits(sh)} Kiro credits`);
  });

  it('the slides band shows the wiring lines of count:wiring', () => {
    expect(lines('cases/slides')).toBe(17);
    expect(pageText).toContain(`Wiring ${lines('cases/slides')} lines`);
  });

  it('shows the sounds of each card', () => {
    const [clickTalk, shoo] = cardsOf();
    for (const s of ['click', 'pop']) expect(clickTalk).toContain(s);
    for (const s of ['click', 'clap', 'knock', 'pop']) expect(shoo).toContain(s);
  });
});

describe('landing page code blocks come from real code (Task 35)', () => {
  const blocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')));
  const slides = squash(read('cases/slides/src/main.ts'));
  const readme = squash(read('README.md'));

  it('has two blocks', () => expect(blocks).toHaveLength(2));

  it('the browser block uses only calls and options of the slides wiring', () => {
    const b = squash(blocks[0]);
    for (const part of ["import { listen } from 'tokk';", 'await listen({', "storageKey: 'tokk:slides',", 'on: {', "'clap clap':", "'clap clap clap':", 'deck.next()', 'deck.prev()',
      "if (!ears.labels.includes('clap'))", "await ears.teach('clap', { ui: true });"]) {
      expect(b, part).toContain(part);
      expect(slides, part).toContain(part);
    }
  });

  it('the Node block is the expectEvents example of the README', () => {
    const b = squash(blocks[1]);
    const call = b.slice(b.indexOf('await expectEvents('));
    expect(call.length).toBeGreaterThan(40);
    expect(readme).toContain(call);
    expect(b).toContain("import { expectEvents } from 'tokk/node';");
  });
});

describe('landing page style (Task 35)', () => {
  const vars = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const light = vars(/:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '');
  const dark = { ...light, ...vars(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '') };

  it('uses the accent of each theme', () => {
    expect(light.accent.toLowerCase()).toBe('#e5482a');
    expect(dark.accent.toLowerCase()).toBe('#ff6a4a');
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).not.toContain('data-theme');
  });

  it('keeps text at 4.5 to 1 and large text and graphics at 3 to 1 in both themes', () => {
    for (const [name, t] of [['light', light], ['dark', dark]] as const) {
      for (const [fg, bg] of [['ink', 'bg'], ['ink', 'panel'], ['ink', 'sunk'], ['muted', 'bg'], ['muted', 'panel'], ['muted', 'sunk'], ['accent-ink', 'accent'], ['code-ink', 'code-bg'], ['bg', 'ink']]) {
        expect(contrastRatio(t[fg], t[bg]), `${name} ${fg} on ${bg}`).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
      }
      for (const bg of ['bg', 'panel']) expect(contrastRatio(t.accent, t[bg]), `${name} accent on ${bg}`).toBeGreaterThanOrEqual(LARGE_CONTRAST_MIN);
    }
  });

  it('has a visible focus outline', () => {
    const focus = /:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(focus).not.toBeNull();
    expect(Number(/outline:\s*(\d+)px/.exec(focus?.[1] ?? '')?.[1])).toBeGreaterThanOrEqual(FOCUS_OUTLINE_MIN_PX);
  });

  it('moves only inside prefers-reduced-motion: no-preference, in the demo box and the flow figure', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(start).toBeGreaterThan(0);
    let depth = 0;
    let end = css.indexOf('{', start);
    for (let i = end; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) { end = i; break; }
    }
    const motion = css.slice(start, end + 1);
    const rest = css.slice(0, start) + css.slice(end + 1);
    expect(rest).not.toMatch(/\banimation(?:-[a-z]+)?\s*:|\btransition\s*:/);
    expect(rest).not.toMatch(/scroll-behavior/);
    const selectors = [...motion.matchAll(/([^{}]+)\{[^{}]*animation/g)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s, s).toMatch(/\.wave|\.flow|\.demo/);
  });

  it('draws the live border with box-shadow only, so the box does not change size', () => {
    const live = /\.demo\.live\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(live).toContain('box-shadow');
    expect(live).not.toMatch(/\b(?:border|padding|margin|width|height)\b[^-]/);
  });
});

describe('demo state (Task 35, pure part)', () => {
  it('names the six states and tells which are live', () => {
    expect([...DEMO_STATES]).toEqual(['idle', 'teach', 'room', 'live', 'rec', 'fail']);
    expect(DEMO_STATES.filter((s) => demoView(s).live)).toEqual(['live', 'rec']);
    expect(DEMO_STATES.filter((s) => demoView(s).waveDim)).toEqual(['idle', 'fail']);
    expect(DEMO_STATES.map((s) => demoView(s).label)).toEqual(['ready', 'teaching clap', 'room sound', 'listening', 'recording', 'no microphone']);
  });

  it('accepts only the six names', () => {
    for (const s of DEMO_STATES) expect(isDemoState(s)).toBe(true);
    for (const s of ['', 'IDLE', 'x', 'constructor', undefined, null, 3]) expect(isDemoState(s)).toBe(false);
  });

  it('the test hook is on only with ?test', () => {
    expect(isTestMode('?test')).toBe(true);
    expect(isTestMode('?a=1&test')).toBe(true);
    expect(isTestMode('')).toBe(false);
    expect(isTestMode('?testing=1')).toBe(false);
  });
});
