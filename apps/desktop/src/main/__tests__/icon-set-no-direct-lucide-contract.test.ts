/**
 * PR-ICON-SET-MAPPING-LAYER-0 step 1 (WAWQAQ msg `265c1636`):
 * every call site imports icons from `@maka/ui/icons`, NEVER directly
 * from `lucide-react`.
 *
 * PR-ICON-SET-MAPPING-LAYER-0 step 2 (WAWQAQ msgs `88ae79a5`, `53735cec`):
 * the underlying library is now Phosphor via Iconify
 * (`@iconify/react` + `@iconify-json/ph`). The mapping layer at
 * `packages/ui/src/icons.tsx` is the ONLY place allowed to touch
 * the Iconify packages. Lucide React is removed entirely.
 *
 * PR-ICONS-FULL-REPLACE-0 step 3 (WAWQAQ msg `60064e2d` 2026-06-24):
 * the source-only sweep wasn't enough — `packages/ui/dist/*.js` (the
 * compiled output that Node module resolution actually hands to the
 * renderer) can lag behind source and silently keep rendering Lucide.
 * Add a dist-scoped sweep so any stale dist trips this contract
 * during `pretest` (which rebuilds dist before tests run).
 *
 * Without this contract, a future feature can:
 *   - re-introduce a direct `import { Foo } from 'lucide-react'`
 *     and silently revert to the old library, OR
 *   - import `@iconify/react` directly and write `<Icon icon="ph:...">`
 *     calls inline, defeating the swap-in-one-file design, OR
 *   - ship a stale @maka/ui/dist whose components.js still imports
 *     from 'lucide-react' even though source has migrated.
 *
 * The test walks every .ts/.tsx in `packages/ui/src` + `apps/desktop/src`:
 *   1. `'lucide-react'` / `"lucide-react"` is banned everywhere
 *      (Lucide is no longer a dependency).
 *   2. `'@iconify/react'` and `'@iconify-json/...'` are banned
 *      everywhere EXCEPT `packages/ui/src/icons.tsx`.
 *   3. Compiled .js files under `packages/ui/dist` also have no
 *      `'lucide-react'` imports (catches stale dist).
 */

import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');
const ICONS_FILE = resolve(REPO_ROOT, 'packages/ui/src/icons.tsx');

async function walkSrc(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkSrc(full)));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function allSrcFiles(): Promise<string[]> {
  const dirs = [
    resolve(REPO_ROOT, 'packages/ui/src'),
    resolve(REPO_ROOT, 'apps/desktop/src'),
  ];
  const out: string[] = [];
  for (const dir of dirs) out.push(...(await walkSrc(dir)));
  return out;
}

async function walkDist(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkDist(full)));
    } else if (entry.isFile() && /\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('PR-ICON-SET-MAPPING-LAYER-0 contract', () => {
  it('lucide-react is removed — no .ts/.tsx file imports it', async () => {
    const files = await allSrcFiles();
    const offenders: string[] = [];
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      if (/['"]lucide-react['"]/.test(stripped)) {
        offenders.push(file.replace(REPO_ROOT + '/', ''));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Lucide-React was removed in step 2 of the icon migration. Use @maka/ui/icons instead:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('packages/ui/dist/**/*.js has no stale lucide-react imports (compiled output sweep)', async () => {
    // The renderer resolves @maka/ui via its package.json `main` /
    // `exports`, both of which point at `packages/ui/dist/*`. If the
    // dist is built from a pre-Phosphor checkout, the renderer keeps
    // serving Lucide icons even after the source migration. `pretest`
    // already runs `npm --workspace @maka/ui run build`, so this
    // sweep sees freshly-compiled dist.
    const distRoot = resolve(REPO_ROOT, 'packages/ui/dist');
    const files = await walkDist(distRoot);
    const offenders: string[] = [];
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      if (/['"]lucide-react['"]/.test(src)) {
        offenders.push(file.replace(REPO_ROOT + '/', ''));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Stale @maka/ui dist still imports from 'lucide-react'. Run \`npm --workspace @maka/ui run clean && npm --workspace @maka/ui run build\` to rebuild from current source:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('every makeIcon(`ph:*`) argument resolves in @iconify-json/ph (no missing glyphs)', async () => {
    // Self-review found: `ph:accessibility` and `ph:file-pencil` were
    // typo'd / non-existent — the wrapper's string indirection hid the
    // bad name behind a runtime `<Icon />` that silently renders a
    // missing/blank glyph (no TS error, no test failure pre-this-PR).
    // This sweep iterates every `makeIcon('ph:...')` arg in icons.tsx
    // and asserts the suffix exists in the Phosphor icon set.
    const phData = (await import('@iconify-json/ph')).icons as { icons: Record<string, unknown> };
    const phNames = new Set(Object.keys(phData.icons));
    const source = await readFile(ICONS_FILE, 'utf8');
    const matches = [...source.matchAll(/makeIcon\(['"]ph:([a-z0-9-]+)['"]\)/g)];
    const missing: string[] = [];
    for (const [, name] of matches) {
      if (!phNames.has(name)) missing.push(name);
    }
    assert.deepEqual(
      missing,
      [],
      `packages/ui/src/icons.tsx references Phosphor glyphs that don't exist in @iconify-json/ph: ${missing.join(', ')}. Pick a real name from icones.js.org/collection/ph.`,
    );
  });

  it('@iconify/react and @iconify-json/* are imported ONLY from packages/ui/src/icons.tsx', async () => {
    const files = await allSrcFiles();
    const offenders: string[] = [];
    for (const file of files) {
      if (file === ICONS_FILE) continue;
      const src = await readFile(file, 'utf8');
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      if (/['"]@iconify\/react['"]/.test(stripped) || /['"]@iconify-json\//.test(stripped)) {
        offenders.push(file.replace(REPO_ROOT + '/', ''));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Only packages/ui/src/icons.tsx may import Iconify packages directly. Use @maka/ui/icons named exports instead:\n  ${offenders.join('\n  ')}`,
    );
  });
});
