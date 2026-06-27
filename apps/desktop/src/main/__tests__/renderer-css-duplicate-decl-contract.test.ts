/**
 * PR-RENDERER-CSS-DEDUPE-0 — lock the rule "no CSS rule declares the
 * same property twice in the same selector block".
 *
 * Duplicate declarations always mean one of two things:
 *   1. A real bug — the first declaration was overridden, intent unclear
 *   2. Forgotten cleanup after a partial refactor (the original `.settingsRow`
 *      bot.css case: `display: flex` was the old flex layout, `display: grid`
 *      was the new layout, the flex props were never removed)
 *
 * Either way, the second declaration always wins (last-wins), and the
 * first becomes dead code that confuses readers + bloats the file. This
 * gate catches them at PR time so they don't slowly accumulate.
 *
 * Notes:
 *   - We scan only flat declarations, not nested at-rules. `@media` /
 *     `@layer` / `@supports` blocks don't trigger dupes here even when
 *     they redeclare the same property (that's the intended semantic).
 *   - CSS custom properties (`--foo`) are excluded — they're frequently
 *     redeclared on purpose under different scopes.
 */

import { strict as assert } from 'node:assert';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');
const STYLES_ROOT = resolve(REPO_ROOT, 'apps/desktop/src/renderer/styles');

async function readCssFiles(dir: string): Promise<{ path: string; content: string }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(dir, entry.name);
      if (entry.isDirectory()) return readCssFiles(entryPath);
      if (!entryPath.endsWith('.css')) return [];
      const content = await readFile(entryPath, 'utf8');
      return [{ path: entryPath, content }];
    }),
  );
  return files.flat();
}

interface Duplicate {
  file: string;
  selector: string;
  property: string;
  firstLine: number;
  secondLine: number;
}

function findDuplicates(file: string, content: string): Duplicate[] {
  const dupes: Duplicate[] = [];
  const lines = content.split('\n');
  // Stack of open blocks. Each entry tracks the selector + first-seen
  // declaration lines. Only the topmost block is the "rule" we care
  // about; outer `@media` / `@layer` blocks are wrappers.
  const stack: { selector: string; props: Record<string, number> }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    // Strip line comments so they don't confuse brace counting.
    const line = lines[i]!.replace(/\/\*.*?\*\//g, '');
    let buf = '';
    for (const ch of line) {
      if (ch === '{') {
        stack.push({ selector: buf.trim(), props: {} });
        buf = '';
      } else if (ch === '}') {
        stack.pop();
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (stack.length === 0) continue;
    const top = stack[stack.length - 1]!;
    if (!top.selector || top.selector.startsWith('@')) continue;
    const declMatch = /^\s*([a-zA-Z-]+)\s*:/.exec(line);
    if (!declMatch) continue;
    const prop = declMatch[1]!;
    if (prop.startsWith('--')) continue;
    const firstLine = top.props[prop];
    if (firstLine) {
      dupes.push({ file, selector: top.selector, property: prop, firstLine, secondLine: lineNo });
    } else {
      top.props[prop] = lineNo;
    }
  }
  return dupes;
}

describe('renderer CSS duplicate declaration contract', () => {
  it('no rule declares the same property twice in the same block', async () => {
    const files = await readCssFiles(STYLES_ROOT);
    const dupes: Duplicate[] = [];
    for (const file of files) {
      dupes.push(...findDuplicates(file.path, file.content));
    }
    const formatted = dupes.map(
      (d) =>
        `${d.file.replace(REPO_ROOT + '/', '')}:${d.secondLine}: ` +
        `"${d.selector}" declares \`${d.property}\` (first at line ${d.firstLine}). ` +
        `Delete one — last-wins makes the first declaration dead code.`,
    );
    assert.deepEqual(
      formatted,
      [],
      `Found ${formatted.length} duplicate CSS declarations:\n${formatted.join('\n')}`,
    );
  });
});
