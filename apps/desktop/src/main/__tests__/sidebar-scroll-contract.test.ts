/**
 * CSS contract test for the sidebar session list scroll architecture
 * (PR-SIDEBAR-IA-0 Phase 1, xuan msg `c253abe0`).
 *
 * The scroll fix lives in plain CSS — there is no component invariant
 * a unit test can exercise. This file is a cheap grep-style regression
 * gate: if a later phase changes `.maka-session-list` or
 * `.maka-list-stack` and drops the grid layout / `min-height: 0` /
 * `overflow: auto`, the list stops scrolling and the footer
 * (Settings + Version info) gets pushed off-screen
 * again — the exact P0 WAWQAQ flagged in msg `761141c5`.
 *
 * The fixture seed (`sidebar-long-sessions`, 60 sessions) and the
 * `scripts/capture-screenshots.mjs` ALL_SCENARIOS entry are the visual
 * baseline gate. This file is the static-analysis gate.
 *
 * Pattern mirrors `stale-sessions.test.ts` "stale session CSS
 * contract" describe block.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { join } from 'node:path';

// Test runs from the desktop workspace root via `node --test dist/...`,
// so `process.cwd()` is `apps/desktop`. Source styles.css lives at
// `src/renderer/styles.css` — we read the source (not a built artifact)
// because the renderer CSS isn't compiled into dist for the test build.
const STYLES_PATH = join(process.cwd(), 'src', 'renderer', 'styles.css');

describe('sidebar session list CSS scroll contract (PR-SIDEBAR-IA-0 Phase 1)', () => {
  it('.maka-session-list is a grid with auto + minmax(0, 1fr) rows', async () => {
    // The grid layout is what makes `.maka-list-stack` a constrained
    // scroll body. Without `minmax(0, 1fr)` on the second row, the
    // stack grows to its content height and `overflow: auto` becomes
    // a no-op (the original P0).
    const css = await readFile(STYLES_PATH, 'utf8');
    // Grab the .maka-session-list rule body. Permissive whitespace
    // matching so a future formatter pass doesn't break the test.
    const ruleBody = extractRuleBody(css, '.maka-session-list');
    assert.ok(ruleBody, '.maka-session-list rule must exist');
    assert.match(ruleBody, /display:\s*grid/, '.maka-session-list must declare display: grid');
    assert.match(
      ruleBody,
      /grid-template-rows:\s*auto\s+minmax\(\s*0\s*,\s*1fr\s*\)/,
      '.maka-session-list must declare grid-template-rows: auto minmax(0, 1fr)',
    );
  });

  it('.maka-session-list has min-height: 0 to allow the grid row to shrink below content', async () => {
    const css = await readFile(STYLES_PATH, 'utf8');
    const ruleBody = extractRuleBody(css, '.maka-session-list');
    assert.ok(ruleBody);
    assert.match(
      ruleBody,
      /min-height:\s*0/,
      '.maka-session-list must declare min-height: 0 so the parent grid row constrains its height',
    );
  });

  it('.maka-list-stack has min-height: 0 and overflow: auto so the scroll body engages', async () => {
    // These two are what actually scroll. They worked correctly before
    // Phase 1 (the bug was the parent), but if a later phase strips
    // them while reshuffling the list rendering, scroll breaks again.
    const css = await readFile(STYLES_PATH, 'utf8');
    const ruleBody = extractRuleBody(css, '.maka-list-stack');
    assert.ok(ruleBody, '.maka-list-stack rule must exist');
    assert.match(
      ruleBody,
      /min-height:\s*0/,
      '.maka-list-stack must declare min-height: 0',
    );
    assert.match(
      ruleBody,
      /overflow:\s*auto/,
      '.maka-list-stack must declare overflow: auto',
    );
  });

  it('.maka-session-panel keeps grid-template-rows with minmax(0, 1fr) for the list row', async () => {
    // The outermost panel must still give .maka-session-list a
    // constrained row. This rule existed before Phase 1; the test
    // pins it so a later phase that reshuffles the panel template
    // (e.g. adding a new section) doesn't accidentally remove the
    // minmax(0, 1fr) cell.
    const css = await readFile(STYLES_PATH, 'utf8');
    const ruleBody = extractRuleBody(css, '.maka-session-panel');
    assert.ok(ruleBody, '.maka-session-panel rule must exist');
    assert.match(
      ruleBody,
      /grid-template-rows:[^;]*minmax\(\s*0\s*,\s*1fr\s*\)/,
      '.maka-session-panel grid-template-rows must include a minmax(0, 1fr) row',
    );
  });
});

/**
 * Extract the body (text between `{` and matching `}`) of a CSS rule
 * by selector. Naive (does not handle nested braces — none of the
 * targeted rules contain them), but enough for top-level flat rules.
 * Returns `undefined` if the selector is not found.
 */
function extractRuleBody(css: string, selector: string): string | undefined {
  // Match `selector { ... }` ignoring extra selectors that might
  // appear on the same rule (e.g. `.a, .b { ... }`). We do an exact
  // selector match anchored at a comma or newline boundary to avoid
  // accidentally matching e.g. `.maka-session-list-title` when looking
  // for `.maka-session-list`.
  const lines = css.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (matchesSelectorLine(line, selector)) {
      // Scan forward to `{`, then collect until matching `}`.
      let braceIndex = line.indexOf('{');
      let cursor = i;
      while (braceIndex === -1 && cursor + 1 < lines.length) {
        cursor++;
        braceIndex = (lines[cursor] ?? '').indexOf('{');
      }
      if (braceIndex === -1) return undefined;
      // Collect from after `{` until closing `}`.
      const body: string[] = [];
      const startLine = lines[cursor] ?? '';
      const startTail = startLine.slice(braceIndex + 1);
      if (startTail.includes('}')) {
        return startTail.slice(0, startTail.indexOf('}'));
      }
      body.push(startTail);
      let j = cursor + 1;
      while (j < lines.length) {
        const next = lines[j] ?? '';
        const closingIdx = next.indexOf('}');
        if (closingIdx !== -1) {
          body.push(next.slice(0, closingIdx));
          return body.join('\n');
        }
        body.push(next);
        j++;
      }
      return undefined;
    }
    i++;
  }
  return undefined;
}

/**
 * Return true if `line` starts a CSS rule whose selector list contains
 * `selector` as an exact token (not a substring of another class).
 */
function matchesSelectorLine(line: string, selector: string): boolean {
  // The selector must appear at the START of the line (allowing only
  // whitespace before) and be followed by a delimiter that proves it's
  // not a longer class name (space, comma, or `{`).
  const trimmed = line.trimStart();
  if (!trimmed.startsWith(selector)) return false;
  const next = trimmed.charAt(selector.length);
  return next === ' ' || next === '\t' || next === ',' || next === '{' || next === '';
}
