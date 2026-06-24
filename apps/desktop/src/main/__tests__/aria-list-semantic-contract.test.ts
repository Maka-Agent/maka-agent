/**
 * PR-ARIA-LIST-SEMANTIC-CONTRACT-TEST-0 (round 27/30): pin the
 * round 16–19 ARIA-list invariant. Background:
 *
 *   PR-MEMORY-BACKUP-LIST-A11Y-0 (round 16)
 *   PR-CONNECTION-LIST-A11Y-0   (round 17)
 *   PR-MEMORY-ENTRY-LIST-A11Y-0 (round 18)
 *   PR-HEALTH-SUMMARY-LIST-A11Y-0 (round 19)
 *
 *   together converted four `<div role="list">` containers with
 *   `<X role="listitem">` children into semantic `<ul>` / `<li>`.
 *   The original shape is an ARIA layering anti-pattern: when
 *   `role="list"` is on a non-`<ul>`/`<ol>` element with default
 *   `list-style: none` CSS, Safari + VoiceOver may strip the list
 *   semantics entirely, leaving screen-reader users with no
 *   indication that the rows form a group. Native `<ul>`/`<li>`
 *   never gets stripped that way; the explicit `role="list"` on
 *   `<ul>` is the conventional defense for Safari's list-style
 *   stripping (see WebAIM AT testing).
 *
 * Without a contract test, a future Settings/Account/Memory pane
 * refactor can re-introduce `<div role="list">` or
 * `<span role="listitem">` and the regression is invisible until
 * a screen-reader user complains.
 *
 * The test walks every .tsx file under
 * `apps/desktop/src/renderer/` and `packages/ui/src/`, strips
 * block comments (the four PR tombstones literally mention the
 * banned strings), and asserts that no JSX element carries
 * `role="list"` unless its tag is `<ul>` or `<ol>`, and no JSX
 * element carries `role="listitem"` unless its tag is `<li>`.
 */

import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

async function walkTsx(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkTsx(full)));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const ALLOWED_LIST_TAGS = new Set(['ul', 'ol']);
const ALLOWED_LISTITEM_TAGS = new Set(['li']);

describe('PR-ARIA-LIST-SEMANTIC-CONTRACT-TEST-0', () => {
  it('no JSX element carries role="list" unless it is <ul>/<ol>, and no role="listitem" unless <li>', async () => {
    const dirs = [
      resolve(REPO_ROOT, 'apps/desktop/src/renderer'),
      resolve(REPO_ROOT, 'packages/ui/src'),
    ];
    const files: string[] = [];
    for (const dir of dirs) files.push(...(await walkTsx(dir)));

    const listOffenders: string[] = [];
    const itemOffenders: string[] = [];

    for (const file of files) {
      const src = await readFile(file, 'utf8');
      // Strip block + line comments. The round-16–19 tombstone
      // comments literally write the banned `role="list"` /
      // `role="listitem"` strings.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');

      const openerRe = /<([a-zA-Z][a-zA-Z0-9]*)\s[^>]*?>/g;
      let match: RegExpExecArray | null;
      while ((match = openerRe.exec(stripped)) !== null) {
        const tag = match[1];
        const opener = match[0];
        const lineNo = stripped.slice(0, match.index).split('\n').length;
        const where = `${file.replace(REPO_ROOT + '/', '')}:${lineNo}`;
        if (/role=['"]list['"]/.test(opener) && !ALLOWED_LIST_TAGS.has(tag)) {
          listOffenders.push(`${where} — <${tag}> role="list" (use <ul>/<ol>)`);
        }
        if (/role=['"]listitem['"]/.test(opener) && !ALLOWED_LISTITEM_TAGS.has(tag)) {
          itemOffenders.push(`${where} — <${tag}> role="listitem" (use <li>)`);
        }
      }
    }

    assert.deepEqual(
      listOffenders,
      [],
      `role="list" on non-<ul>/<ol> tags reintroduces the ARIA layering anti-pattern from rounds 16–19. Offenders:\n  ${listOffenders.join('\n  ')}`,
    );
    assert.deepEqual(
      itemOffenders,
      [],
      `role="listitem" on non-<li> tags reintroduces the ARIA layering anti-pattern from rounds 16–19. Offenders:\n  ${itemOffenders.join('\n  ')}`,
    );
  });
});
