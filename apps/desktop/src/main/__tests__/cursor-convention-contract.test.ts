/**
 * Static-analysis contract for the native cursor convention.
 *
 * Native macOS / Windows reserve the pointing-hand cursor (`cursor: pointer`)
 * for hyperlinks; buttons, rows, tabs, toggles and other controls use the
 * default arrow. The renderer had drifted into ~66 controls setting
 * `cursor: pointer` ad hoc, so hover was inconsistent (sidebar showed a hand,
 * titlebar an arrow).
 *
 * This gate keeps the convention from drifting back: every `cursor: pointer`
 * declaration must sit on a LINK selector (its name contains `link`). A new
 * genuine link may join by being named `*link*`; a control may not reintroduce
 * the hand. The runtime look-and-feel (which element shows which cursor) is
 * still verified in a real window — this is the source bound.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { join } from 'node:path';

const STYLES_PATH = join(process.cwd(), 'src', 'renderer', 'styles.css');
const TOKENS_PATH = join(process.cwd(), 'src', 'renderer', 'maka-tokens.css');

/** A selector is allowed to carry the hand cursor only if it is a link. */
const LINK_SELECTOR = /link/;

describe('native cursor convention contract', () => {
  for (const path of [STYLES_PATH, TOKENS_PATH]) {
    it(`${path.split('/').slice(-1)[0]}: cursor:pointer lives only on link selectors`, async () => {
      const css = await readFile(path, 'utf8');
      const offenders: string[] = [];
      for (const rule of iterateRules(css)) {
        if (!/cursor:\s*pointer/.test(rule.body)) continue;
        if (!LINK_SELECTOR.test(rule.selector)) offenders.push(rule.selector);
      }
      assert.deepEqual(
        offenders,
        [],
        `\`cursor: pointer\` (the link/hand cursor) must not sit on control selectors. Native macOS reserves the hand for links; controls use the default arrow. Offending selectors in ${path}:\n  ${offenders.join('\n  ')}\nIf one is genuinely a link, name it \`*link*\` so it joins the allowlist; otherwise drop the declaration (the arrow is the default).`,
      );
    });
  }

  it('the internal markdown link keeps the hand cursor', async () => {
    const css = await readFile(STYLES_PATH, 'utf8');
    const rule = findRule(css, '.maka-markdown-link-internal');
    assert.ok(rule, '.maka-markdown-link-internal rule must exist');
    assert.match(
      rule!,
      /cursor:\s*pointer/,
      'the link-styled in-app nav button must keep the hand cursor — it presents as a link',
    );
  });
});

/** Return the body of the first flat rule whose selector list includes `target`. */
function findRule(css: string, target: string): string | null {
  for (const rule of iterateRules(css)) {
    if (rule.selector.split(',').some((s) => s.trim() === target)) {
      return `${rule.selector} { ${rule.body.trim()} }`;
    }
  }
  return null;
}

/** Yield each flat `selector { body }` rule, recursing into at-rules. */
function* iterateRules(css: string): Generator<{ selector: string; body: string }> {
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i]!)) i++;
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) return;
      i = end + 2;
      continue;
    }
    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) return;
    const selector = css.slice(i, braceIdx).trim();
    let depth = 1;
    let j = braceIdx + 1;
    while (j < css.length && depth > 0) {
      const ch = css[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    if (depth !== 0) return;
    const body = css.slice(braceIdx + 1, j - 1);
    if (selector.startsWith('@')) {
      yield* iterateRules(body);
    } else {
      yield { selector, body };
    }
    i = j;
  }
}
