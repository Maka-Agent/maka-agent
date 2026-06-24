/**
 * PR-RADIUS-CONTRACT-CONVERGE-0 (kenji's category 3, 2026-06-24):
 * lock the Maka radius vocabulary so a single PR can't softly inflate
 * the chrome into "more rounded" territory and break sharp identity.
 *
 * Per docs/design-system.md §1.4 (post-PR):
 *   - chrome: 0 (page/layout) + 6 (button) + 8 (modal) + 10 (code block)
 *   - 大面板 (workspace plate, floating card): 12px ceiling — matches
 *     macOS window outer chrome so cards read as "inside the chrome"
 *   - pill/chip/round dot: 999px exception
 *
 * Anything `border-radius: > 12px` in renderer CSS is banned (except
 * the 999px pill). When a future surface NEEDS a bigger radius, the
 * design owner can update this contract AND the doc together — that
 * keeps the doc + code in sync instead of drifting.
 *
 * Tailwind utility classes (`rounded-xl` = 12px is fine; `rounded-2xl`
 * = 16px / `rounded-3xl` = 24px violate) are checked in renderer code
 * too, but UI primitives are NOT covered here — kenji's z-index lane
 * already touches Dialog/Sheet/Drawer/Command, and bumping those needs
 * a separate visual review on every modal surface.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');
const STYLES_FILE = resolve(REPO_ROOT, 'apps/desktop/src/renderer/styles.css');
const TOKENS_FILE = resolve(REPO_ROOT, 'apps/desktop/src/renderer/maka-tokens.css');
const DOC_FILE = resolve(REPO_ROOT, 'docs/design-system.md');

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Returns every `border-radius: <N>px` site whose N > 12 and N !== 999. */
function findOversizedRadii(css: string): string[] {
  const stripped = stripCssComments(css);
  const matches = [...stripped.matchAll(/border-radius:\s*([0-9]+)px/g)];
  return matches
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 12 && n !== 999)
    .map(String);
}

describe('PR-RADIUS-CONTRACT-CONVERGE-0 contract', () => {
  it('styles.css has no border-radius > 12px (except 999px pill)', async () => {
    const styles = await readFile(STYLES_FILE, 'utf8');
    const offenders = findOversizedRadii(styles);
    assert.deepEqual(
      offenders,
      [],
      `styles.css must keep radius ≤ 12px per docs/design-system.md §1.4. Found offending values: ${offenders.join(', ')}.`,
    );
  });

  it('maka-tokens.css has no border-radius > 12px (except 999px pill)', async () => {
    const tokens = await readFile(TOKENS_FILE, 'utf8');
    const offenders = findOversizedRadii(tokens);
    assert.deepEqual(
      offenders,
      [],
      `maka-tokens.css must keep radius ≤ 12px. Found offending values: ${offenders.join(', ')}.`,
    );
  });

  it('Tailwind `rounded-2xl` / `rounded-3xl` (≥16px) is banned in renderer + UI source', async () => {
    // Self-review: original test claimed Tailwind classes are checked
    // but no assertion enforced it. `rounded-xl` (12px) is allowed —
    // it's the documented ceiling. `rounded-2xl` (16px Tailwind) and
    // `rounded-3xl` (24px) break the cap.
    const { readdir } = await import('node:fs/promises');
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && /\.(tsx|ts)$/.test(entry.name)) {
          const src = await readFile(full, 'utf8');
          if (/\brounded-(2xl|3xl)\b/.test(src)) {
            offenders.push(full.replace(REPO_ROOT + '/', ''));
          }
        }
      }
    }
    await walk(resolve(REPO_ROOT, 'packages/ui/src'));
    await walk(resolve(REPO_ROOT, 'apps/desktop/src/renderer'));
    assert.deepEqual(
      offenders,
      [],
      `Tailwind \`rounded-2xl\` / \`rounded-3xl\` exceed the 12px cap. Use \`rounded-xl\` instead:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('docs/design-system.md spells out the 12px ceiling', async () => {
    const doc = await readFile(DOC_FILE, 'utf8');
    assert.match(
      doc,
      /大面板上限 12px/,
      'docs/design-system.md §1.4 must explicitly state the 12px workspace-plate ceiling so future PRs see the rule.',
    );
    assert.match(
      doc,
      /14\/16\/18\/20px/,
      'docs/design-system.md §1.4 must explicitly list the banned values (14/16/18/20px) — otherwise it just says "no big radius" without telling reviewers what to flag.',
    );
  });
});
