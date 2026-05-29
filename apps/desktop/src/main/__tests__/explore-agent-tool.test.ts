import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildExploreAgentTool, runReadOnlyExplore } from '../explore-agent-tool.js';

describe('ExploreAgent read-only worker', () => {
  it('exposes a permission-gated subagent tool', () => {
    const tool = buildExploreAgentTool();
    assert.equal(tool.name, 'ExploreAgent');
    assert.equal(tool.permissionRequired, true);
    assert.equal(tool.categoryHint, 'subagent');
    assert.match(tool.description, /read-only/);
    assert.match(tool.description, /never writes/);
  });

  it('returns source-grounded matches without absolute paths', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      await writeFile(join(workspaceRoot, 'src', 'permission.ts'), [
        'export const policy = {',
        "  explore: 'read-only subagent',",
        '};',
      ].join('\n'));
      await writeFile(join(workspaceRoot, 'README.md'), '# Demo\npermission model overview');

      const result = await runReadOnlyExplore({
        cwd: workspaceRoot,
        objective: 'study permission policy',
        roots: ['.'],
        queries: ['permission', 'subagent'],
        maxFiles: 10,
        maxMatches: 10,
      });

      assert.equal(result.ok, true);
      assert.equal(result.mode, 'read_only');
      assert.deepEqual(result.roots, ['.']);
      assert.ok(result.filesInspected >= 2);
      assert.ok(result.matches.some((match) => match.path === 'src/permission.ts' && match.query === 'subagent'));
      assert.ok(result.candidateFiles.some((file) => file.path === 'src/permission.ts'));
      assert.equal(JSON.stringify(result).includes(workspaceRoot), false);
      assert.ok(result.notes.some((note) => /no writes, no network/.test(note)));
    });
  });

  it('rejects roots outside cwd and skips symlinked content', async () => {
    await withWorkspace(async (workspaceRoot) => {
      const outside = await mkdtemp(join(tmpdir(), 'maka-explore-outside-'));
      try {
        await writeFile(join(outside, 'secret.ts'), 'subscription_token = "secret"');
        await symlink(outside, join(workspaceRoot, 'linked-outside'));

        const invalid = await runReadOnlyExplore({
          cwd: workspaceRoot,
          objective: 'inspect secret',
          roots: ['../'],
          queries: ['secret'],
        });
        assert.equal(invalid.ok, false);
        assert.equal(invalid.reason, 'invalid_root');

        const result = await runReadOnlyExplore({
          cwd: workspaceRoot,
          objective: 'inspect secret',
          roots: ['.'],
          queries: ['secret'],
        });
        assert.equal(result.ok, true);
        assert.equal(result.matches.length, 0);
        assert.equal(JSON.stringify(result).includes('subscription_token'), false);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('runs through the tool impl with the session cwd only', async () => {
    await withWorkspace(async (workspaceRoot) => {
      await writeFile(join(workspaceRoot, 'notes.md'), 'PawWork explore worker notes');
      const tool = buildExploreAgentTool();
      const result = await tool.impl(
        { objective: 'find PawWork notes', queries: ['PawWork'] },
        {
          sessionId: 's1',
          turnId: 't1',
          cwd: workspaceRoot,
          toolCallId: 'tool-1',
          abortSignal: new AbortController().signal,
          emitOutput: () => {},
        },
      );
      assert.equal(result.ok, true);
      assert.ok(result.matches.some((match) => match.path === 'notes.md'));
    });
  });
});

async function withWorkspace(fn: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'maka-explore-agent-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}
