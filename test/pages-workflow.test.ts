// Task 21 (requirement 9, test P1): line-based checks of .github/workflows/pages.yml. No YAML dependency.
// The checks run on samples that break each rule first.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './web/paths';

const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'pages.yml');
const ALLOWED_PERMISSIONS = ['contents: read', 'id-token: write', 'pages: write'];
// Looked up by the operator with `git ls-remote --tags` on 2026-11-20 (design.md, "Pinned actions").
const PINNED: Record<string, { sha: string; tag: string }> = {
  'actions/checkout': { sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', tag: 'v7.0.1' },
  'actions/setup-node': { sha: '949feb2413d6458794dcd2491c4babbbce0c15c1', tag: 'v7.1.0' },
  'actions/upload-pages-artifact': { sha: 'fc324d3547104276b827a68afc52ff2a11cc49c9', tag: 'v5.0.0' },
  'actions/deploy-pages': { sha: '368f82528645a54fb793d4d04e342629a3f51346', tag: 'v5.0.1' },
};
const FORBIDDEN_STEP = /\b(?:npm\s+(?:run\s+)?test|test:web|playwright|check:public-api|tsc|vitest)\b/i;

export function checkWorkflow(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  const code = lines.map((l) => (l.trimStart().startsWith('#') ? '' : l));
  const trimmed = code.map((l) => l.trim());
  const at = (re: RegExp, from = 0): number => trimmed.findIndex((l, i) => i >= from && re.test(l));

  // 1. Triggers.
  const onAt = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (onAt < 0) problems.push('no on: block');
  else {
    const end = lines.findIndex((l, i) => i > onAt && /^\S/.test(l));
    const block = lines.slice(onAt + 1, end < 0 ? undefined : end).join('\n');
    if (!/^\s{2}push:\s*\n\s{4}branches:\s*\[\s*main\s*\]/m.test(block)) problems.push('push must be limited to branches: [main]');
    if (!/^\s{2}workflow_dispatch:/m.test(block)) problems.push('no workflow_dispatch trigger');
    if (/pull_request|schedule|workflow_run|release/.test(block)) problems.push('another trigger');
  }
  // 2. Permissions, top level, exactly three.
  const permAt = lines.findIndex((l) => /^permissions:\s*$/.test(l));
  if (permAt < 0) problems.push('no top-level permissions block');
  else {
    const given: string[] = [];
    for (let i = permAt + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) given.push(lines[i].trim());
    if (JSON.stringify([...given].sort()) !== JSON.stringify(ALLOWED_PERMISSIONS)) problems.push(`permissions must be exactly ${ALLOWED_PERMISSIONS.join(', ')}, got ${given.join(', ')}`);
  }
  // 3. Concurrency.
  const concAt = lines.findIndex((l) => /^concurrency:\s*$/.test(l));
  if (concAt < 0 || !/group:\s*pages\b/.test(lines[concAt + 1] ?? '') || !/cancel-in-progress:\s*false\b/.test(lines[concAt + 2] ?? '')) {
    problems.push('concurrency must have group: pages and cancel-in-progress: false');
  }
  // 4. Step order in the build job, and the deploy job.
  const order = [/uses:\s*actions\/checkout@/, /uses:\s*actions\/setup-node@/, /run:\s*npm ci\s*$/, /run:\s*npm run build:site\s*$/, /uses:\s*actions\/upload-pages-artifact@/];
  let from = 0;
  const found: number[] = [];
  for (const re of order) {
    const i = at(re, from);
    if (i < 0) { problems.push(`missing or out of order step: ${re.source}`); break; }
    found.push(i); from = i + 1;
  }
  const upload = found[4];
  if (upload !== undefined && !trimmed.slice(upload, upload + 4).some((l) => l === 'path: site')) problems.push('upload-pages-artifact needs path: site');
  const setup = found[1];
  if (setup !== undefined) {
    const near = trimmed.slice(setup, setup + 6);
    if (!near.some((l) => /^node-version:\s*['"]?(\d+)/.test(l) && Number(/(\d+)/.exec(l)?.[1]) >= 20)) problems.push('node-version must be 20 or higher');
    if (!near.includes('cache: npm')) problems.push('setup-node needs cache: npm');
  }
  const deployJob = at(/^deploy:\s*$/);
  if (deployJob < 0) problems.push('no deploy job');
  else {
    const rest = trimmed.slice(deployJob);
    if (!rest.includes('needs: build')) problems.push('deploy needs: build');
    if (!rest.includes('name: github-pages')) problems.push('deploy environment name: github-pages');
    if (!rest.includes('url: ${{ steps.deployment.outputs.page_url }}')) problems.push('deploy environment url');
    if (!rest.some((l) => /uses:\s*actions\/deploy-pages@/.test(l))) problems.push('no deploy-pages step');
    if (!rest.some((l) => /^(?:-\s+)?id:\s*deployment$/.test(l))) problems.push('deploy step needs id: deployment');
    if (found[4] !== undefined && deployJob < found[4]) problems.push('deploy job must come after the build job');
  }
  // 5. No test step in code lines, one comment line that says why.
  trimmed.forEach((l, i) => { if (l && FORBIDDEN_STEP.test(l)) problems.push(`test step at line ${i + 1}: ${l}`); });
  if (!lines.some((l) => /^\s*#.*no test step/i.test(l))) problems.push('no comment line that says why there is no test step');
  // 6. Pinned actions.
  const used: string[] = [];
  lines.forEach((l, i) => {
    const m = /^\s*(?:-\s*)?uses:\s*(\S+)@(\S+)(.*)$/.exec(l);
    if (!m) return;
    used.push(m[1]);
    const pin = PINNED[m[1]];
    if (!/^[0-9a-f]{40}$/.test(m[2])) problems.push(`line ${i + 1}: ${m[1]} is not pinned to a 40-character SHA`);
    else if (!pin) problems.push(`line ${i + 1}: unexpected action ${m[1]}`);
    else if (pin.sha !== m[2]) problems.push(`line ${i + 1}: ${m[1]} SHA is not the recorded one`);
    if (!/#\s*v\d+\.\d+\.\d+\s*$/.test(m[3])) problems.push(`line ${i + 1}: ${m[1]} has no tag comment`);
    else if (pin && !m[3].includes(pin.tag)) problems.push(`line ${i + 1}: ${m[1]} tag comment is not ${pin.tag}`);
  });
  for (const name of Object.keys(PINNED)) if (!used.includes(name)) problems.push(`${name} is not used`);
  return problems;
}

const GOOD = `name: Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # No test step: tests run locally, and a CI-only failure must not block a deploy.
      - uses: actions/checkout@${PINNED['actions/checkout'].sha} # ${PINNED['actions/checkout'].tag}
      - uses: actions/setup-node@${PINNED['actions/setup-node'].sha} # ${PINNED['actions/setup-node'].tag}
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build:site
      - uses: actions/upload-pages-artifact@${PINNED['actions/upload-pages-artifact'].sha} # ${PINNED['actions/upload-pages-artifact'].tag}
        with:
          path: site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@${PINNED['actions/deploy-pages'].sha} # ${PINNED['actions/deploy-pages'].tag}
`;

describe('pages workflow (Task 21, P1)', () => {
  it('the checks accept the good sample and fail on a sample that breaks each rule', () => {
    expect(checkWorkflow(GOOD)).toEqual([]);
    const breaks: [string, (t: string) => string][] = [
      ['pull_request trigger', (t) => t.replace('  workflow_dispatch:', '  workflow_dispatch:\n  pull_request:')],
      ['branch not main', (t) => t.replace('[main]', '[dev]')],
      ['no dispatch', (t) => t.replace('  workflow_dispatch:\n', '')],
      ['extra permission', (t) => t.replace('  id-token: write', '  id-token: write\n  actions: write')],
      ['missing permission', (t) => t.replace('  pages: write\n', '')],
      ['cancel in progress', (t) => t.replace('cancel-in-progress: false', 'cancel-in-progress: true')],
      ['steps out of order', (t) => t.replace('- run: npm ci\n      - run: npm run build:site', '- run: npm run build:site\n      - run: npm ci')],
      ['wrong path', (t) => t.replace('path: site', 'path: dist')],
      ['old node', (t) => t.replace('node-version: 22', 'node-version: 18')],
      ['no cache', (t) => t.replace('cache: npm', 'cache: pnpm')],
      ['no needs', (t) => t.replace('needs: build', 'needs: other')],
      ['no environment url', (t) => t.replace('page_url', 'other')],
      ['test step', (t) => t.replace('- run: npm ci', '- run: npm ci\n      - run: npm test')],
      ['playwright step', (t) => t.replace('- run: npm ci', '- run: npx playwright test')],
      ['no why comment', (t) => t.replace('# No test step:', '# Note:')],
      ['tag instead of sha', (t) => t.replace(PINNED['actions/checkout'].sha, 'v7')],
      ['wrong sha', (t) => t.replace(PINNED['actions/checkout'].sha, 'a'.repeat(40))],
      ['no tag comment', (t) => t.replace(` # ${PINNED['actions/deploy-pages'].tag}`, '')],
      ['wrong tag comment', (t) => t.replace(` # ${PINNED['actions/setup-node'].tag}`, ' # v1.0.0')],
      ['unexpected action', (t) => t.replace('- run: npm ci', '- uses: actions/cache@' + 'b'.repeat(40) + ' # v1.0.0\n      - run: npm ci')],
    ];
    for (const [name, apply] of breaks) expect(checkWorkflow(apply(GOOD)), name).not.toEqual([]);
  });

  it('P1: .github/workflows/pages.yml passes every check', () => {
    expect(existsSync(WORKFLOW_PATH), 'the file exists').toBe(true);
    expect(checkWorkflow(readFileSync(WORKFLOW_PATH, 'utf8'))).toEqual([]);
  });
});
