import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  normalizeBranchFromTurnInput,
  normalizePermissionResponse,
  normalizeRegenerateTurnInput,
  normalizeRetryTurnInput,
  normalizeSessionSendCommand,
  normalizeStopSessionInput,
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

  it('normalizes session send commands and rejects malformed send payloads', () => {
    assert.deepEqual(
      normalizeSessionSendCommand({
        type: 'send',
        turnId: 'turn-1',
        text: 'hello',
        attachments: [{ kind: 'image' }],
        extra: true,
      }),
      {
        type: 'send',
        turnId: 'turn-1',
        text: 'hello',
        attachments: [{ kind: 'image' }],
      },
    );
    assert.deepEqual(
      normalizeSessionSendCommand({ type: 'send', text: 'hello' }),
      { type: 'send', text: 'hello' },
    );
    assert.equal(normalizeSessionSendCommand({ type: 'stop' }), undefined);
    assert.throws(() => normalizeSessionSendCommand(null), /session command/);
    assert.throws(() => normalizeSessionSendCommand({ type: 'send', text: '' }), /send text/);
    assert.throws(() => normalizeSessionSendCommand({ type: 'send', turnId: 1, text: 'hello' }), /send turnId/);
  });

  it('normalizes stop session input and rejects malformed stop sources', () => {
    assert.deepEqual(normalizeStopSessionInput(undefined), {});
    assert.deepEqual(normalizeStopSessionInput({ source: 'stop_button', extra: true }), { source: 'stop_button' });
    assert.throws(() => normalizeStopSessionInput(null), /stop session input/);
    assert.throws(() => normalizeStopSessionInput({ source: 'toolbar' }), /stop session source/);
  });

  it('routes send and stop IPC payloads through main-process normalizers', async () => {
    const mainPath = fileURLToPath(new URL('../../../src/main/main.ts', import.meta.url));
    const main = await readFile(mainPath, 'utf8');
    const stopHandler = main.match(/ipcMain\.handle\('sessions:stop'[\s\S]*?\n  \);/)?.[0] ?? '';
    const sendHandler = main.match(/ipcMain\.handle\('sessions:send'[\s\S]*?\n  \);/)?.[0] ?? '';

    assert.match(stopHandler, /normalizeStopSessionInput\(input\)/);
    assert.doesNotMatch(stopHandler, /runtime\.stopSession\(sessionId,\s*input\)/);
    assert.match(stopHandler, /emitSessionsChanged\('status-change',\s*sessionId\)/);
    assert.match(stopHandler, /emitSessionsChanged\('turn-status-change',\s*sessionId\)/);
    assert.match(stopHandler, /emitSessionsChanged\('message-appended',\s*sessionId\)/);
    assert.match(sendHandler, /normalizeSessionSendCommand\(command\)/);
    assert.doesNotMatch(sendHandler, /command\.text/);
    assert.doesNotMatch(sendHandler, /command\.attachments/);
  });

  it('renderer stop() and respondToPermission() surface IPC failures as toasts (PR-STOP-ERROR-SURFACE-0)', async () => {
    // The Composer wires onStop via both the button onClick and the
    // Escape key handler, neither of which awaits the returned
    // promise. If stop() lets the IPC reject without try/catch the
    // failure dies as UnhandledPromiseRejection and the user sees
    // nothing while the model keeps streaming. Same applies to
    // respondToPermission().
    const rendererPath = fileURLToPath(new URL('../../../src/renderer/main.tsx', import.meta.url));
    const renderer = await readFile(rendererPath, 'utf8');
    // Match `async function stop()` body up to its closing brace.
    const stop = renderer.match(/async function stop\(\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(stop, 'stop() must exist in main.tsx');
    assert.match(stop[0], /try\s*\{[\s\S]*?await window\.maka\.sessions\.stop/);
    assert.match(stop[0], /catch \(error\)[\s\S]*?toastApi\.error\(['"]停止失败['"]/);
    const respond = renderer.match(/async function respondToPermission\([\s\S]*?\n  \}/);
    assert.ok(respond, 'respondToPermission() must exist');
    assert.match(respond[0], /try\s*\{[\s\S]*?await window\.maka\.sessions\.respondToPermission/);
    assert.match(respond[0], /catch \(error\)[\s\S]*?toastApi\.error\(['"]响应失败['"]/);
  });

  it('renderer clears permission overlay when a session completes (PR-PERMISSION-UI-CLEANUP-0)', async () => {
    // Without this, a session that finishes for a reason other than
    // permission_handoff would leave a stranded permission entry in
    // `permissionBySession[sessionId]`, keeping the overlay visible
    // and blocking the session UI until the user manually navigates
    // away. Mirrors the existing `abort` cleanup.
    const rendererPath = fileURLToPath(new URL('../../../src/renderer/main.tsx', import.meta.url));
    const renderer = await readFile(rendererPath, 'utf8');
    // Find the 'complete' case in handleSessionEvent — the body must
    // null out permissionBySession[sessionId] when stopReason is
    // not permission_handoff.
    const completeCase = renderer.match(/case 'complete':[\s\S]*?break;/);
    assert.ok(completeCase, "'complete' case must exist in renderer event handler");
    assert.match(
      completeCase[0],
      /setPermissionBySession\(\(current\) => \(\{\s*\.\.\.current,\s*\[sessionId\]:\s*undefined\s*\}\)\)/,
      "'complete' case must clear permissionBySession for the session — mirrors the abort handler",
    );
  });

  it('PermissionDialog submit() awaits onRespond and resets pending in finally (PR-PERMISSION-UI-CLEANUP-0)', async () => {
    // Critical interaction with PR-STOP-ERROR-SURFACE-0: the parent
    // respondToPermission now swallows IPC errors via toast. If
    // submit() doesn't reset pending on resolve OR catch, the
    // dialog buttons lock up forever after a failed IPC.
    const componentsPath = fileURLToPath(new URL('../../../../../packages/ui/src/components.tsx', import.meta.url));
    const components = await readFile(componentsPath, 'utf8');
    const submit = components.match(/async function submit\(decision:[\s\S]*?\n  \}/);
    assert.ok(submit, 'PermissionDialog submit() must be async');
    assert.match(submit[0], /await props\.onRespond\(/);
    assert.match(submit[0], /\}\s*finally\s*\{[\s\S]*?responsePendingRef\.current\s*=\s*false[\s\S]*?setResponsePending\(false\)/);
  });

  it('toast items carry role="alert" so screen readers announce them (PR-PERMISSION-UI-CLEANUP-0)', async () => {
    const toastPath = fileURLToPath(new URL('../../../../../packages/ui/src/toast.tsx', import.meta.url));
    const toast = await readFile(toastPath, 'utf8');
    assert.match(
      toast,
      /<li[^>]*role="alert"/,
      'each toast <li> must declare role="alert" — the parent aria-live region alone is unreliable on macOS VoiceOver / NVDA',
    );
  });

  it('refreshes active messages when a sessions:changed message-appended event arrives', async () => {
    const rendererPath = fileURLToPath(new URL('../../../src/renderer/main.tsx', import.meta.url));
    const renderer = await readFile(rendererPath, 'utf8');

    // PR-OAUTH-CARD-LIVE-STATE-0: the renderer uses a local
    // `changedSessionId = event.sessionId` shadow var + a truthy
    // guard before comparing to activeIdRef. Match either spelling
    // and allow the intermediate truthy check so this contract
    // doesn't rot when the implementation tweaks the guard shape.
    assert.match(
      renderer,
      /event\.reason === 'message-appended'[\s\S]{0,80}?(?:event\.sessionId|changedSessionId) === activeIdRef\.current[\s\S]*?refreshMessages\((?:event\.sessionId|changedSessionId)\)/,
    );
  });
});
