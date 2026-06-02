import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  normalizeBranchFromTurnInput,
  normalizePermissionResponse,
  normalizeRegenerateTurnInput,
  normalizeRetryTurnInput,
} from '../permission-response-guard.js';

describe('permission response IPC boundary', () => {
  it('normalizes valid allow / deny responses into the core shape', () => {
    assert.deepEqual(
      normalizePermissionResponse({
        requestId: 'permission-1',
        decision: 'allow',
        rememberForTurn: true,
        extra: 'ignored',
      }),
      {
        requestId: 'permission-1',
        decision: 'allow',
        rememberForTurn: true,
      },
    );
    assert.deepEqual(
      normalizePermissionResponse({ requestId: 'permission-2', decision: 'deny' }),
      { requestId: 'permission-2', decision: 'deny' },
    );
  });

  it('rejects malformed renderer decisions instead of treating them as allow', () => {
    assert.throws(() => normalizePermissionResponse(null), /Invalid permission response/);
    assert.throws(() => normalizePermissionResponse({ requestId: '', decision: 'allow' }), /requestId/);
    assert.throws(
      () => normalizePermissionResponse({ requestId: 'permission-1', decision: 'approve' }),
      /decision/,
    );
    assert.throws(
      () => normalizePermissionResponse({ requestId: 'permission-1', decision: 'deny', rememberForTurn: 'yes' }),
      /rememberForTurn/,
    );
  });

  it('routes sessions:respondToPermission through the main-process normalizer', async () => {
    const mainPath = fileURLToPath(new URL('../../../src/main/main.ts', import.meta.url));
    const main = await readFile(mainPath, 'utf8');
    const handler = main.match(/ipcMain\.handle\('sessions:respondToPermission'[\s\S]*?\n  \);/)?.[0] ?? '';

    assert.match(handler, /normalizePermissionResponse\(response\)/);
    assert.doesNotMatch(handler, /runtime\.respondToPermission\(sessionId,\s*response\)/);
  });

  it('normalizes turn action inputs before retry / regenerate / branch runtime calls', () => {
    assert.deepEqual(
      normalizeRetryTurnInput({ sourceTurnId: 'turn-1', turnId: 'retry-1', extra: true }),
      { sourceTurnId: 'turn-1', turnId: 'retry-1' },
    );
    assert.deepEqual(
      normalizeRegenerateTurnInput({ sourceTurnId: 'turn-2' }),
      { sourceTurnId: 'turn-2' },
    );
    assert.deepEqual(
      normalizeBranchFromTurnInput({ sourceTurnId: 'turn-3', name: '  Branch name  ', ignored: 1 }),
      { sourceTurnId: 'turn-3', name: 'Branch name' },
    );
  });

  it('rejects malformed turn action inputs at the IPC boundary', () => {
    assert.throws(() => normalizeRetryTurnInput(null), /retry turn input/);
    assert.throws(() => normalizeRetryTurnInput({ sourceTurnId: '' }), /sourceTurnId/);
    assert.throws(() => normalizeRegenerateTurnInput({ sourceTurnId: 'turn-1', turnId: 1 }), /turnId/);
    assert.throws(() => normalizeBranchFromTurnInput({ sourceTurnId: 'turn-1', name: 1 }), /branch name/);
  });

  it('routes turn actions through main-process normalizers', async () => {
    const mainPath = fileURLToPath(new URL('../../../src/main/main.ts', import.meta.url));
    const main = await readFile(mainPath, 'utf8');
    const retryHandler = main.match(/ipcMain\.handle\('sessions:retryTurn'[\s\S]*?\n  \);/)?.[0] ?? '';
    const regenerateHandler = main.match(/ipcMain\.handle\('sessions:regenerateTurn'[\s\S]*?\n  \);/)?.[0] ?? '';
    const branchHandler = main.match(/ipcMain\.handle\('sessions:branchFromTurn'[\s\S]*?\n  \);/)?.[0] ?? '';

    assert.match(retryHandler, /normalizeRetryTurnInput\(input\)/);
    assert.doesNotMatch(retryHandler, /runtime\.retryTurn\(sessionId,\s*\{\s*\.\.\.input/);
    assert.match(regenerateHandler, /normalizeRegenerateTurnInput\(input\)/);
    assert.doesNotMatch(regenerateHandler, /runtime\.regenerateTurn\(sessionId,\s*\{\s*\.\.\.input/);
    assert.match(branchHandler, /normalizeBranchFromTurnInput\(input\)/);
    assert.doesNotMatch(branchHandler, /runtime\.branchFromTurn\(sessionId,\s*input\)/);
  });
});
