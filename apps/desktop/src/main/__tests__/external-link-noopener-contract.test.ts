/**
 * PR-EXTERNAL-LINK-NOOPENER-CONTRACT-TEST-0 (round 26/30): pin the
 * round-20 invariant — every `target="_blank"` anchor in the
 * renderer surface MUST carry `rel="noopener"` (or stronger).
 *
 * Background. PR-EXTERNAL-LINK-NOOPENER-0 (round 20) auditied the
 * renderer for `target="_blank"` anchors missing `rel`, and added
 * `rel="noopener noreferrer"` (or `rel="noreferrer noopener"`) to
 * every external link. The risk is reverse-tabnabbing: an external
 * site can navigate the opener via `window.opener.location` if the
 * tab is opened without `noopener`. In an Electron renderer this
 * is particularly bad because the opener IS the app shell.
 *
 * Without a contract test, a future feature can quietly drop the
 * `rel` attribute (or land a new `target="_blank"` link without
 * it) and the regression is invisible until someone audits.
 *
 * This test scans every renderer-side .tsx file under
 * `apps/desktop/src/renderer/` and `packages/ui/src/` for the
 * `target="_blank"` literal. Every match site MUST be paired with
 * a `rel="..."` attribute that mentions `noopener` within the
 * same JSX element.
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

describe('PR-EXTERNAL-LINK-NOOPENER-CONTRACT-TEST-0', () => {
  it('every target="_blank" in renderer surface carries rel=noopener', async () => {
    const dirs = [
      resolve(REPO_ROOT, 'apps/desktop/src/renderer'),
      resolve(REPO_ROOT, 'packages/ui/src'),
    ];
    const files: string[] = [];
    for (const dir of dirs) files.push(...(await walkTsx(dir)));

    const offenders: string[] = [];
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      // Strip block comments — round-20 tombstones and prose
      // comments often mention `target="_blank"` literally.
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');

      // Match each JSX <a ...>...</a> opening tag (greedy attrs,
      // stop at the first `>` that closes the tag). We require
      // every opener carrying `target="_blank"` to also carry a
      // `rel="..."` attribute that mentions `noopener` somewhere.
      const openerRe = /<a\s[^>]*?>/g;
      let match: RegExpExecArray | null;
      while ((match = openerRe.exec(stripped)) !== null) {
        const tag = match[0];
        if (!/target=['"]_blank['"]/.test(tag)) continue;
        const relMatch = tag.match(/\brel=['"]([^'"]*)['"]/);
        if (!relMatch || !/noopener/.test(relMatch[1])) {
          const lineNo = stripped.slice(0, match.index).split('\n').length;
          offenders.push(`${file.replace(REPO_ROOT + '/', '')}:${lineNo} — ${tag.slice(0, 80)}…`);
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Every target="_blank" anchor must carry rel="noopener" (reverse-tabnabbing). Offenders:\n  ${offenders.join('\n  ')}`,
    );
  });
});
