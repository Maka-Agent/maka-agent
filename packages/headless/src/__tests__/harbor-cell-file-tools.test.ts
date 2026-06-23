import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { describe, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHarborCellLocalToolExecutor } from '../harbor-cell.js';
import { buildIsolatedHeadlessTools } from '../tools.js';

// Real local executor (actual child processes). Regression guard for the
// bounded-tail change: Read/Glob/Grep run through the SAME executor.exec as Bash,
// so when Bash's bounded tail was (briefly) the default exec semantics, a large
// file or result was silently head-dropped to a tail. Read must return the FULL
// file, head-first — only Bash opts into a bounded tail.

const toolCtx = (cwd: string) => ({
  sessionId: 's',
  turnId: 't',
  cwd,
  toolCallId: 'tool-1',
  abortSignal: new AbortController().signal,
  emitOutput: () => {},
});

function tool(tools: ReturnType<typeof buildIsolatedHeadlessTools>, name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

describe('Harbor local executor file tools (real spawn)', () => {
  test('Read enforces its 50KB byte budget exactly, with a resumable offset (P1 regression)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'maka-harbor-read-'));
    // Fixed 92-char lines -> each output line is exactly "%6d\t" + 92 + "\n" = 100
    // bytes, so the 51200-byte budget stops precisely after line 512. HEAD is line 1,
    // TAIL line 1000 (far past the budget): head-first Read keeps HEAD and drops TAIL;
    // a bounded tail would do the opposite.
    const N = 1000;
    const lines = Array.from({ length: N }, (_, i) =>
      (i === 0 ? 'HEAD' : i === N - 1 ? 'TAIL' : `line${i + 1}`).padEnd(92, '.'));
    await writeFile(join(cwd, 'big.txt'), lines.join('\n') + '\n', 'utf8');
    const tools = buildIsolatedHeadlessTools(createHarborCellLocalToolExecutor());

    const result = (await tool(tools, 'Read').impl({ path: 'big.txt' }, toolCtx(cwd))) as { content: string };

    assert.ok(result.content.includes('HEAD'), 'head retained — Read is not tail-bounded');
    assert.ok(!result.content.includes('TAIL'), 'tail beyond the byte budget is not returned');
    // 512 lines x 100 bytes = 51200; the only extra is the one-line continuation hint.
    assert.ok(result.content.length <= 51200 + 80, 'output stays within the 50KB budget plus the hint');
    assert.ok(result.content.length >= 51200 - 100, 'the full budget is used (512 lines), not a smaller cap');
    const hint = result.content.match(/pass offset=(\d+) to read more/);
    assert.equal(hint?.[1], '512', 'hint offset equals the last emitted line number');

    // Resume from the hint offset: the next page must start at the very next line.
    const next = (await tool(tools, 'Read').impl({ path: 'big.txt', offset: 512 }, toolCtx(cwd))) as { content: string };
    assert.ok(next.content.startsWith('   513\t'), 'resuming at offset=512 continues from line 513 — no gap or overlap');
    // (Glob/Grep share the same command-backed executor.exec with no boundedTail
    //  flag — see the "only Bash opts into bounded-tail" contract test — so this
    //  head-first guarantee covers them too without generating MBs of matches.)
  });
});
