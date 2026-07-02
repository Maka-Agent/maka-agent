/**
 * Radius governance contract (#406 gap 4).
 *
 * Per docs/design-system.md §1.4:
 *   - control  6px  — button / input / chip / kbd / inline code / tab trigger / nav row
 *   - surface  8px  — card / popover / menu popup / alert / toolbar / tab list / select popup
 *   - modal   12px — Settings / Confirm / Permission modal / floating card
 *   - pill    999px — pill / badge / round dot / switch / checkbox / radio / progress
 *
 * Tailwind alias map (styles.css):
 *   rounded-sm → --radius-control (6px)
 *   rounded-md → --radius-surface (8px)
 *   rounded-lg → --radius-surface (8px)  [deprecated, kept for compat]
 *   rounded-xl → --radius-modal (12px)
 *   rounded-full → --radius-pill (999px)
 *
 * Contract rules:
 *   1. CSS `border-radius` (shorthand + physical + logical longhand) must
 *      reference a whitelisted `--radius-*` token, or be 0 / 50% / inherit / initial.
 *   2. TSX `rounded-[...]` and directional `rounded-{t|tr|tl|b|br|bl|l|r|s|e|ss|se|es|ee}-[...]`
 *      must likewise reference a whitelisted token.
 *   3. `calc(var(--radius-*))` may only *shrink* (subtract Npx); `+Npx` is banned.
 *   4. `rounded-2xl` / `rounded-3xl` (≥16px) are banned.
 *   5. Control components must use `rounded-sm`; surface components `rounded-md`;
 *      Badge must use `rounded-[var(--radius-pill)]`.
 *   6. Token values are pinned: control=6px, surface=8px, modal=12px, pill=999px.
 */

import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { REPO_ROOT, TOKENS_FILE, STYLES_FILE, readAllRendererCss, stripCssComments } from './css-test-helpers.js';

// --- token whitelist (single source of truth for all paths) -----------------

const RADIUS_TOKEN_WHITELIST = new Set([
  '--radius-control',
  '--radius-surface',
  '--radius-modal',
  '--radius-pill',
  '--radius-button', // alias → control
  '--radius-sm', // tailwind alias → control
  '--radius-md', // tailwind alias → surface
  '--radius-lg', // tailwind alias → surface
  '--radius-xl', // tailwind alias → modal
]);

function extractRadiusToken(expr: string): string | null {
  const m = expr.match(/^var\((--radius-[\w-]+)\)$/);
  return m ? m[1] : null;
}

function isWhitelistedVar(expr: string): boolean {
  const tok = extractRadiusToken(expr);
  return tok !== null && RADIUS_TOKEN_WHITELIST.has(tok);
}

/**
 * calc() must be exactly `calc(var(--radius-whitelisted) - <positive>px)`.
 * Positive allowlist — any other calc form (addition, multiplication,
 * division, double-negative, no token, non-whitelisted token) fails.
 */
const CALC_ALLOW_RE = /^calc\(var\((--radius-[\w-]+)\)\s*-\s*([1-9]\d*(?:\.\d+)?|0?\.\d*[1-9])px\)$/;

function isWhitelistedCalc(expr: string): boolean {
  const m = expr.match(CALC_ALLOW_RE);
  if (!m) return false;
  return RADIUS_TOKEN_WHITELIST.has(m[1]);
}

const LITERAL_OK = /^(?:0+(?:px|%)?|50%|inherit|initial)$/;

function isAllowedCorner(corner: string): boolean {
  if (LITERAL_OK.test(corner)) return true;
  return isWhitelistedVar(corner) || isWhitelistedCalc(corner);
}

// --- CSS scanning (single entry: readAllRendererCss unfolds all imports) -----

const RADIUS_DECL_RE = /border-radius:\s*([^;}\n]+)\s*[;}]/g;
const RADIUS_LONGHAND_RE = /border-(?:top-left|top-right|bottom-left|bottom-right|start-start|start-end|end-start|end-end)-radius:\s*([^;}\n]+)\s*[;}]/g;

function findCssOffenders(css: string, label: string): string[] {
  const stripped = stripCssComments(css);
  const offenders: string[] = [];
  for (const re of [RADIUS_DECL_RE, RADIUS_LONGHAND_RE]) {
    for (const m of stripped.matchAll(re)) {
      const raw = m[1].trim();
      const cleaned = raw.replace(/!\s*important$/, '').trim();
      if (cleaned.split(/\s+/).every(isAllowedCorner)) continue;
      offenders.push(`${label}: ${m[0].replace(/\s+/g, ' ').trim()}`);
    }
  }
  return offenders;
}

// --- TSX/TS scanning --------------------------------------------------------

const ROUNDED_RE = /rounded-(?:\[(?<arb>[^\]]+)\]|(?<tw>2xl|3xl)\b|(?:t|tr|tl|b|br|bl|l|r|s|e|ss|se|es|ee)-\[(?<dir>[^\]]+)\])/g;

async function collectTsxOffenders(): Promise<string[]> {
  const offenders: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(tsx|ts)$/.test(entry.name)) continue;
      const src = await readFile(full, 'utf8');
      const label = full.replace(REPO_ROOT + '/', '');
      for (const m of src.matchAll(ROUNDED_RE)) {
        const groups = m.groups as { arb?: string; tw?: string; dir?: string } | undefined;
        if (groups?.tw) {
          offenders.push(`${label}: rounded-${groups.tw} (≥16px, exceeds 12px cap)`);
          continue;
        }
        const val = (groups?.arb ?? groups?.dir ?? '').trim();
        if (LITERAL_OK.test(val)) continue;
        if (isWhitelistedVar(val) || isWhitelistedCalc(val)) continue;
        // menu.tsx checkbox-thumb morph animation — dynamic, not a static tier
        if (/^var\(--thumb-size\)\/calc\(var\(--thumb-size\)\*1\.10\)$/.test(val)) continue;
        offenders.push(`${label}: rounded-[${val}]`);
      }
    }
  }
  await walk(resolve(REPO_ROOT, 'packages/ui/src'));
  await walk(resolve(REPO_ROOT, 'apps/desktop/src/renderer'));
  return offenders;
}

// --- component → expected radius tier contract ------------------------------

type Tier = 'control' | 'surface' | 'pill';

interface ComponentRadiusCheck {
  file: string;
  name: string;
  tier: Tier;
}

/** The expected radius class for each tier. */
const TIER_CLASS: Record<Tier, string[]> = {
  control: ['rounded-sm'],
  surface: ['rounded-md'],
  pill: ['rounded-[var(--radius-pill)]', 'rounded-full'],
};

/** Classes that belong to a *different* tier — must not appear. */
const ALL_TIER_CLASSES = ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-full', 'rounded-[var(--radius-pill)]', 'rounded-[var(--radius-control)]', 'rounded-[var(--radius-surface)]', 'rounded-[var(--radius-modal)]'];

function classesForOtherTiers(tier: Tier): string[] {
  return ALL_TIER_CLASSES.filter((c) => !TIER_CLASS[tier].includes(c));
}

const COMPONENT_RADIUS: ComponentRadiusCheck[] = [
  { file: 'packages/ui/src/ui.tsx', name: 'buttonVariants', tier: 'control' },
  { file: 'packages/ui/src/ui.tsx', name: 'inputClasses', tier: 'control' },
  { file: 'packages/ui/src/ui.tsx', name: 'SelectItem', tier: 'control' },
  { file: 'packages/ui/src/ui.tsx', name: 'Toggle', tier: 'control' },
  { file: 'packages/ui/src/ui.tsx', name: 'TabsTrigger', tier: 'control' },
  { file: 'packages/ui/src/ui.tsx', name: 'badgeVariants', tier: 'pill' },
  { file: 'packages/ui/src/ui.tsx', name: 'TabsList', tier: 'surface' },
  { file: 'packages/ui/src/ui.tsx', name: 'SelectPopup', tier: 'surface' },
  { file: 'packages/ui/src/ui.tsx', name: 'ToggleGroup', tier: 'surface' },
  { file: 'packages/ui/src/primitives/input-group.tsx', name: 'InputGroup', tier: 'control' },
  { file: 'packages/ui/src/primitives/badge.tsx', name: 'badgeVariants', tier: 'pill' },
  { file: 'packages/ui/src/primitives/item.tsx', name: 'itemVariants', tier: 'surface' },
  { file: 'packages/ui/src/primitives/menu.tsx', name: 'MenuPopup', tier: 'surface' },
  { file: 'packages/ui/src/primitives/alert.tsx', name: 'alertVariants', tier: 'surface' },
  { file: 'packages/ui/src/primitives/toolbar.tsx', name: 'Toolbar', tier: 'surface' },
  { file: 'packages/ui/src/session-list-panel.tsx', name: 'navRowVariants', tier: 'control' },
  { file: 'packages/ui/src/session-list-panel.tsx', name: 'settingsButtonClass', tier: 'control' },
  { file: 'packages/ui/src/session-list-panel.tsx', name: 'rowActionVariants', tier: 'control' },
];

function checkComponentTier(src: string, check: ComponentRadiusCheck): string[] {
  const offenders: string[] = [];
  const re = new RegExp(
    `(?:const\\s+${check.name}\\s*=|export\\s+const\\s+${check.name}\\s*=|function\\s+${check.name}\\b)[\\s\\S]*?(?=\\nexport\\s|$)`,
    'g',
  );
  const expected = TIER_CLASS[check.tier];
  const forbidden = classesForOtherTiers(check.tier);
  let matched = 0;
  for (const m of src.matchAll(re)) {
    matched++;
    const block = m[0];
    const hasExpected = expected.some((c) => block.includes(c));
    if (!hasExpected) {
      offenders.push(`${check.file}: ${check.name} must use ${expected.join(' or ')} (${check.tier}), found none`);
    }
    for (const bad of forbidden) {
      if (block.includes(bad)) {
        offenders.push(`${check.file}: ${check.name} must not use ${bad} (wrong tier for ${check.tier})`);
      }
    }
  }
  if (matched === 0) {
    offenders.push(`${check.file}: ${check.name} not found in source — stale contract entry or renamed component`);
  }
  return offenders;
}

// --- token value pinning ----------------------------------------------------

async function parseRadiusTokenValues(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const tokens = await readFile(TOKENS_FILE, 'utf8');
  for (const m of tokens.matchAll(/^\s*(--radius-[\w-]+):\s*([^;]+);/gm)) {
    map.set(m[1], m[2].trim());
  }
  const styles = await readFile(STYLES_FILE, 'utf8');
  for (const m of styles.matchAll(/^\s*(--radius-[\w-]+):\s*([^;]+);/gm)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

// === tests ==================================================================

describe('radius token governance (#406 gap 4)', () => {
  it('CSS uses only whitelisted --radius-* tokens (no bare Npx, no longhand, no logical, no private tokens)', async () => {
    const css = await readAllRendererCss();
    const offenders = findCssOffenders(css, 'renderer CSS');
    assert.deepEqual(offenders, [], `Offenders:\n  ${offenders.join('\n  ')}`);
  });

  it('TSX uses no hardcoded rounded-[Npx], no directional/logical rounded-*-[Npx], no rounded-2xl/3xl', async () => {
    const offenders = await collectTsxOffenders();
    assert.deepEqual(offenders, [], `Offenders:\n  ${offenders.join('\n  ')}`);
  });

  it('components use the correct radius tier (control/surface/pill)', async () => {
    const offenders: string[] = [];
    for (const check of COMPONENT_RADIUS) {
      const src = await readFile(resolve(REPO_ROOT, check.file), 'utf8');
      offenders.push(...checkComponentTier(src, check));
    }
    assert.deepEqual(offenders, [], `Component tier violations:\n  ${offenders.join('\n  ')}`);
  });

  it('CSS class selectors .maka-code and .maka-skeleton-card use --radius-surface', async () => {
    const css = await readAllRendererCss();
    const stripped = stripCssComments(css);
    const checks: Record<string, RegExp> = {
      '.maka-code': /\.maka-code\s*\{[^}]*border-radius:\s*var\(--radius-surface\)/,
      '.maka-skeleton-card': /\.maka-skeleton-card\s*\{[^}]*border-radius:\s*var\(--radius-surface\)/,
    };
    const offenders: string[] = [];
    for (const [sel, re] of Object.entries(checks)) {
      if (!re.test(stripped)) {
        offenders.push(`${sel} must use border-radius: var(--radius-surface)`);
      }
    }
    assert.deepEqual(offenders, [], `Selector violations:\n  ${offenders.join('\n  ')}`);
  });

  it('radius token values are pinned to 6/8/12/999px', async () => {
    const tokens = await parseRadiusTokenValues();
    const expected: Record<string, string> = {
      '--radius-control': '6px',
      '--radius-surface': '8px',
      '--radius-modal': '12px',
      '--radius-pill': '999px',
    };
    for (const [tok, val] of Object.entries(expected)) {
      assert.equal(tokens.get(tok), val, `${tok} must be ${val}. Update this test AND docs/design-system.md §1.4 together.`);
    }
    const aliases: Record<string, string> = {
      '--radius-button': 'var(--radius-control)',
      '--radius-sm': 'var(--radius-control)',
      '--radius-md': 'var(--radius-surface)',
      '--radius-lg': 'var(--radius-surface)',
      '--radius-xl': 'var(--radius-modal)',
    };
    for (const [tok, val] of Object.entries(aliases)) {
      assert.equal(tokens.get(tok), val, `${tok} must be ${val}.`);
    }
  });
});

describe('radius whitelist negative cases', () => {
  it('rejects typos and private tokens in var()', () => {
    assert.equal(isWhitelistedVar('var(--radius-modla)'), false, 'typo must fail');
    assert.equal(isWhitelistedVar('var(--radius-private)'), false, 'private token must fail');
    assert.equal(isWhitelistedVar('var(--radius-control)'), true, 'valid token must pass');
  });

  it('rejects calc() with non-whitelisted tokens', () => {
    assert.equal(isWhitelistedCalc('calc(var(--radius-private) + 1px)'), false, 'private token must fail');
    assert.equal(isWhitelistedCalc('calc(var(--radius-modla) - 1px)'), false, 'typo must fail');
    assert.equal(isWhitelistedCalc('calc(var(--radius-control) - 1px)'), true, 'valid token subtraction must pass');
  });

  it('calc() allowlist: only var(--radius-*) - <positive>px passes', () => {
    assert.equal(isWhitelistedCalc('calc(var(--radius-modal) + 20px)'), false, 'addition must fail');
    assert.equal(isWhitelistedCalc('calc(var(--radius-surface) + 8px)'), false, 'addition must fail');
    assert.equal(isWhitelistedCalc('calc(var(--radius-modal) * 1.5)'), false, 'multiplication must fail');
    assert.equal(isWhitelistedCalc('calc(var(--radius-modal) / 0.5)'), false, 'division must fail');
    assert.equal(isWhitelistedCalc('calc(var(--radius-modal) - -1px)'), false, 'double-negative must fail');
    assert.equal(isWhitelistedCalc('calc(var(--radius-modal) - 0px)'), false, 'zero subtraction must fail');
    assert.equal(isWhitelistedCalc('calc(var(--radius-modal) - 1px)'), true, 'subtraction must pass');
    assert.equal(isWhitelistedCalc('calc(var(--radius-xl) - 1px)'), true, 'subtraction with alias must pass');
    assert.equal(isWhitelistedCalc('calc(var(--radius-sm) - 1.5px)'), true, 'fractional subtraction must pass');
  });
});