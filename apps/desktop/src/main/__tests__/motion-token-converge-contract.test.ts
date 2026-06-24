/**
 * PR-MOTION-TOKEN-CONVERGE-0 (kenji's category 4, 2026-06-24):
 * lock the motion vocabulary so individual PRs can't silently drift
 * back to ad-hoc easing / `transition: all`.
 *
 * Three invariants:
 *
 * 1. `cubic-bezier(0.16, 1, 0.3, 1)` (the project's canonical out-strong
 *    curve) MUST be referenced via `var(--ease-out-strong)` — only the
 *    token definition in `maka-tokens.css` is allowed to spell the raw
 *    curve. Bare uses in styles.css drift visually and require an
 *    apparent-but-unobvious update when the curve gets retuned.
 *
 * 2. `transition: all` is banned everywhere. It animates properties
 *    that shouldn't move (layout, color, transform together) and
 *    triggers compositor-heavy reflows. Enumerate the properties.
 *
 * 3. `--duration-{quick,base,emphasized,large}` tokens are defined in
 *    `maka-tokens.css`. This test pins the names so a rename gets
 *    flagged at the test layer before any styles.css site drifts.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');
const TOKENS_FILE = resolve(REPO_ROOT, 'apps/desktop/src/renderer/maka-tokens.css');
const STYLES_FILE = resolve(REPO_ROOT, 'apps/desktop/src/renderer/styles.css');

/** Strip CSS block comments so banned strings inside `/* ... *\/`
 *  documentation don't trip the contract. */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('PR-MOTION-TOKEN-CONVERGE-0 contract', () => {
  it('bare cubic-bezier(0.16, 1, 0.3, 1) appears ONLY in the --ease-out-strong token declaration', async () => {
    // Self-review: the original test only scanned styles.css, so
    // bare curves in maka-tokens.css itself slipped through (one site
    // at maka-tokens.css:1017 transition rule). Now we scan BOTH
    // files; the only allowed site is the `--ease-out-strong: <curve>;`
    // token declaration line itself (which we whitelist by stripping
    // it before counting).
    const RAW_CURVE = /cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/g;
    const TOKEN_DECL = /--ease-out-strong:\s*cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)\s*;?/g;

    const styles = stripCssComments(await readFile(STYLES_FILE, 'utf8'));
    const stylesMatches = styles.match(RAW_CURVE) ?? [];
    assert.equal(
      stylesMatches.length,
      0,
      `styles.css must not spell the canonical curve directly — use var(--ease-out-strong). Found ${stylesMatches.length} site(s).`,
    );

    const tokensRaw = await readFile(TOKENS_FILE, 'utf8');
    assert.match(
      tokensRaw,
      /--ease-out-strong:\s*cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/,
      '--ease-out-strong must be defined in maka-tokens.css with the canonical curve.',
    );

    // Strip the token declaration site + comments before scanning;
    // any remaining bare curve is a violation in the tokens file too.
    const tokens = stripCssComments(tokensRaw).replace(TOKEN_DECL, '');
    const tokensMatches = tokens.match(RAW_CURVE) ?? [];
    assert.equal(
      tokensMatches.length,
      0,
      `maka-tokens.css must not spell the canonical curve directly outside the --ease-out-strong declaration — use var(--ease-out-strong). Found ${tokensMatches.length} site(s).`,
    );
  });

  it('`transition: all` is banned in renderer CSS — properties must be enumerated', async () => {
    const styles = stripCssComments(await readFile(STYLES_FILE, 'utf8'));
    const tokens = stripCssComments(await readFile(TOKENS_FILE, 'utf8'));
    for (const [name, body] of [['styles.css', styles] as const, ['maka-tokens.css', tokens] as const]) {
      const matches = body.match(/transition:\s*all\b/g) ?? [];
      assert.equal(
        matches.length,
        0,
        `${name} must not use \`transition: all\` — enumerate the properties (e.g. \`transition: background 150ms var(--ease-out-strong), color 150ms var(--ease-out-strong)\`).`,
      );
    }
  });

  it('--duration-{quick,base,emphasized,large} tokens are defined in maka-tokens.css', async () => {
    const tokens = await readFile(TOKENS_FILE, 'utf8');
    assert.match(tokens, /--duration-quick:\s*120ms/, '--duration-quick must be 120ms');
    assert.match(tokens, /--duration-base:\s*150ms/, '--duration-base must be 150ms');
    assert.match(tokens, /--duration-emphasized:\s*180ms/, '--duration-emphasized must be 180ms');
    assert.match(tokens, /--duration-large:\s*280ms/, '--duration-large must be 280ms');
  });

  it('--ease-out-strong / --ease-in-out-strong / --ease-drawer tokens are defined', async () => {
    const tokens = await readFile(TOKENS_FILE, 'utf8');
    assert.match(tokens, /--ease-out-strong:\s*cubic-bezier/);
    assert.match(tokens, /--ease-in-out-strong:\s*cubic-bezier/);
    assert.match(tokens, /--ease-drawer:\s*cubic-bezier/);
  });
});
