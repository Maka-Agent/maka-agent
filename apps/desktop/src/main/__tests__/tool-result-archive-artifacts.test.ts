import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createArtifactStore, type ArtifactStore } from '@maka/storage';
import type { ToolResultArchiveRecorderInput } from '@maka/runtime';
import { persistArchivedToolResultToArtifacts } from '../tool-result-archive-artifacts.js';

describe('desktop tool-result archive artifacts', () => {
  test('reuses the archive artifact for the same stale tool result body', async () => {
    await withStore(async (store) => {
      const event = archiveEvent();

      const first = await persistArchivedToolResultToArtifacts(store, event);
      const second = await persistArchivedToolResultToArtifacts(store, event);

      assert.equal(second.artifactId, first.artifactId);
      const records = await store.list(event.sessionId);
      assert.equal(records.length, 1);
      assert.equal(records[0]?.id, first.artifactId);
      assert.equal(records[0]?.source, 'tool_result_archive');
    });
  });
});

function archiveEvent(): ToolResultArchiveRecorderInput {
  const result = { body: 'large archived output'.repeat(20) };
  const serializedResult = JSON.stringify(result);
  return {
    sessionId: 'session-1',
    runtimeEventId: 'runtime-result-1',
    turnId: 'turn-1',
    toolCallId: 'tool-call-1',
    toolName: 'Read',
    result,
    serializedResult,
    bodySha256: sha256(serializedResult),
    originalEstimatedTokens: serializedResult.length,
    originalBytes: Buffer.byteLength(serializedResult, 'utf8'),
    rewriteVersion: 1,
    reason: 'stale_tool_result_pruned_before_compact',
  };
}

async function withStore(fn: (store: ArtifactStore) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'maka-tool-result-archive-'));
  try {
    await fn(createArtifactStore(workspaceRoot));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
