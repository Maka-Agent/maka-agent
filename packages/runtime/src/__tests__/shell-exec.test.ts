import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runShellWithBoundedTail } from '../shell-exec.js';

const base = (over: Record<string, unknown> = {}) => ({ cwd: process.cwd(), timeoutMs: 30_000, ...over });

describe('runShellWithBoundedTail', () => {
  test('returns full small output and exit 0 without throwing', async () => {
    const r = await runShellWithBoundedTail("printf 'hello\\nworld\\n'", base());
    assert.deepEqual(
      { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut, aborted: r.aborted },
      { exitCode: 0, stdout: 'hello\nworld\n', stderr: '', timedOut: false, aborted: false },
    );
  });

  test('keeps only the bounded, line-aligned TAIL of large output (never killed by size)', async () => {
    const r = await runShellWithBoundedTail(
      "printf 'HEADMARK\\n'; seq 1 50; printf 'TAILMARK\\n'",
      base({ maxRetainedChars: 12 }),
    );
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('TAILMARK'), 'tail retained');
    assert.ok(!r.stdout.includes('HEADMARK'), 'head dropped — it is a tail');
    assert.ok(r.stdout.length <= 12, `tail bounded to cap, got ${r.stdout.length}`);
  });

  test('captures stderr and a non-zero exit code as data (does not reject)', async () => {
    const r = await runShellWithBoundedTail("printf 'oops\\n' >&2; exit 3", base());
    assert.equal(r.exitCode, 3);
    assert.equal(r.stderr, 'oops\n');
    assert.equal(r.stdout, '');
  });

  test('times out a slow command, kills it, and reports timedOut', async () => {
    const r = await runShellWithBoundedTail('sleep 5', base({ timeoutMs: 150 }));
    assert.equal(r.timedOut, true);
    assert.equal(r.exitCode, 124);
  });

  test('surfaces a safety marker (not bare empty) when an oversized no-newline line is dropped', async () => {
    // One 500-char line with no newline, cap 50: BashTailBuffer drops it whole
    // (no safe truncation boundary), so without a marker the result would look
    // like the command produced nothing.
    const r = await runShellWithBoundedTail("head -c 500 /dev/zero | tr '\\0' x", base({ maxRetainedChars: 50 }));
    assert.equal(r.exitCode, 0);
    assert.ok(!r.stdout.includes('xxxx'), 'dropped content is not leaked');
    assert.ok(r.stdout.includes('omitted for safety'), 'a recoverable safety marker is present');
  });

  test('emits every chunk live via emitOutput', async () => {
    const seen: Array<[string, string]> = [];
    await runShellWithBoundedTail(
      "printf 'aaa'; printf 'bbb' >&2",
      base({ emitOutput: (s: 'stdout' | 'stderr', c: string) => seen.push([s, c]) }),
    );
    assert.ok(seen.some(([s, c]) => s === 'stdout' && c.includes('aaa')));
    assert.ok(seen.some(([s, c]) => s === 'stderr' && c.includes('bbb')));
  });

  test('caps live emitOutput per stream with a single suppressed marker (result keeps full tail)', async () => {
    const seen: Array<[string, string]> = [];
    const r = await runShellWithBoundedTail(
      "printf 'HEAD\\n'; seq 1 2000; printf 'TAIL\\n'",
      base({
        maxLiveEmitChars: 20, // tiny cap so the stream trips it almost immediately
        emitOutput: (s: 'stdout' | 'stderr', c: string) => seen.push([s, c]),
      }),
    );
    assert.equal(r.exitCode, 0);
    const stdoutEmits = seen.filter(([s]) => s === 'stdout');
    const markers = stdoutEmits.filter(([, c]) => c.includes('live output suppressed'));
    assert.equal(markers.length, 1, 'exactly one suppressed marker, not one per chunk');
    const liveChars = stdoutEmits
      .filter(([, c]) => !c.includes('live output suppressed'))
      .reduce((n, [, c]) => n + c.length, 0);
    assert.ok(liveChars <= 20, `live emit bounded to cap, got ${liveChars}`);
    // The suppressed LIVE feed does not lose the result: the retained tail still
    // carries the real output (the last bytes the command produced).
    assert.ok(r.stdout.includes('TAIL'), 'retained tail keeps the command output');
  });
});
