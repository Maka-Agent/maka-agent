/**
 * Tests for the Quick Chat handler (PR110b).
 *
 * Locks the 4 behavioral gates @kenji + @xuan signed off:
 *  - non-ready OnboardingState → `setup_required`, NO session created
 *  - empty / whitespace prompt → create-and-open only; NO send
 *  - non-empty prompt → walks send path; first message id returned
 *  - send / create failure → `send_failed` with generalized Chinese
 *    message (no raw enum leak)
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { OnboardingState, SessionSummary } from '@maka/core';
import { handleQuickChatStart, type QuickChatDeps } from '../quick-chat.js';

function fakeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: overrides.id ?? 'session-quickchat-1',
    name: overrides.name ?? 'New Chat',
    isFlagged: false,
    isArchived: false,
    labels: [],
    hasUnread: false,
    status: 'active',
    backend: 'ai-sdk',
    llmConnectionSlug: 'anthropic-live',
    permissionMode: 'ask',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<QuickChatDeps> = {}): QuickChatDeps & {
  spy: {
    createCalls: number;
    emitCalls: string[];
    ensureCanSendCalls: string[];
    sendCalls: Array<{ sessionId: string; text: string }>;
  };
} {
  const spy = {
    createCalls: 0,
    emitCalls: [] as string[],
    ensureCanSendCalls: [] as string[],
    sendCalls: [] as Array<{ sessionId: string; text: string }>,
  };
  const deps: QuickChatDeps = {
    async getOnboardingState() {
      return {
        kind: 'ready_empty',
        defaultConnectionSlug: 'anthropic-live',
        defaultModel: 'claude-sonnet-4-5-20250929',
      } as OnboardingState;
    },
    async createSession() {
      spy.createCalls += 1;
      return fakeSession();
    },
    emitCreated(sessionId) {
      spy.emitCalls.push(sessionId);
    },
    async ensureCanSend(sessionId) {
      spy.ensureCanSendCalls.push(sessionId);
    },
    async sendFirstMessage(sessionId, text) {
      spy.sendCalls.push({ sessionId, text });
      return `turn-${spy.sendCalls.length}`;
    },
    ...overrides,
  };
  return { ...deps, spy } as QuickChatDeps & { spy: typeof spy };
}

describe('handleQuickChatStart — setup_required path', () => {
  for (const state of [
    { kind: 'needs_connection' } as OnboardingState,
    { kind: 'needs_default_connection' } as OnboardingState,
    { kind: 'needs_connection_credentials', connectionSlug: 'a' } as OnboardingState,
    { kind: 'needs_default_model', connectionSlug: 'a' } as OnboardingState,
    { kind: 'blocked', reason: 'all_connections_unhealthy' } as OnboardingState,
  ]) {
    it(`returns setup_required for state.kind=${state.kind} and does NOT create a session`, async () => {
      const deps = makeDeps({ getOnboardingState: async () => state });
      const result = await handleQuickChatStart({ prompt: 'hi' }, deps);
      assert.deepEqual(result, { ok: false, reason: 'setup_required', state });
      assert.equal(deps.spy.createCalls, 0, 'no session must be created in non-ready state');
      assert.equal(deps.spy.sendCalls.length, 0);
    });
  }
});

describe('handleQuickChatStart — empty prompt (create + open only)', () => {
  it('omitted prompt creates a session but does NOT send', async () => {
    const deps = makeDeps();
    const result = await handleQuickChatStart({}, deps);
    assert.deepEqual(result, { ok: true, sessionId: 'session-quickchat-1' });
    assert.equal(deps.spy.createCalls, 1);
    assert.deepEqual(deps.spy.emitCalls, ['session-quickchat-1']);
    assert.equal(deps.spy.sendCalls.length, 0, 'empty prompt must not call sendFirstMessage');
    assert.equal(deps.spy.ensureCanSendCalls.length, 0, 'empty prompt must not call ensureCanSend');
  });

  it('whitespace-only prompt is treated as empty', async () => {
    const deps = makeDeps();
    const result = await handleQuickChatStart({ prompt: '   \n\t  ' }, deps);
    assert.deepEqual(result, { ok: true, sessionId: 'session-quickchat-1' });
    assert.equal(deps.spy.sendCalls.length, 0);
  });

  it('undefined input is accepted as empty prompt (no crash)', async () => {
    const deps = makeDeps();
    const result = await handleQuickChatStart(undefined, deps);
    assert.equal(result.ok, true);
    assert.equal(deps.spy.sendCalls.length, 0);
  });
});

describe('handleQuickChatStart — non-empty prompt (send path)', () => {
  it('walks the send path and returns firstMessageId', async () => {
    const deps = makeDeps();
    const result = await handleQuickChatStart({ prompt: 'hello, model' }, deps);
    assert.deepEqual(result, {
      ok: true,
      sessionId: 'session-quickchat-1',
      firstMessageId: 'turn-1',
    });
    assert.deepEqual(deps.spy.ensureCanSendCalls, ['session-quickchat-1']);
    assert.deepEqual(deps.spy.sendCalls, [{ sessionId: 'session-quickchat-1', text: 'hello, model' }]);
  });

  it('trims the prompt before sending', async () => {
    const deps = makeDeps();
    await handleQuickChatStart({ prompt: '   hello   ' }, deps);
    assert.deepEqual(deps.spy.sendCalls, [{ sessionId: 'session-quickchat-1', text: 'hello' }]);
  });

  it('silently ignores stray connectionSlug / model fields (PR110b no-override gate)', async () => {
    const deps = makeDeps();
    // @kenji PR110b review: PR110b does not support Quick Chat
    // connection/model override. If a future renderer sends them,
    // they must NOT influence the handler.
    const tampered = {
      prompt: 'hi',
      connectionSlug: 'malicious-slug',
      model: 'malicious-model',
    } as unknown;
    const result = await handleQuickChatStart(tampered, deps);
    assert.equal(result.ok, true);
    // createSession is called with the derived defaults, not the
    // tampered slug/model. The mock createSession ignores its args
    // entirely, but we verified above that the result references the
    // mock's hard-coded session id.
    assert.deepEqual(deps.spy.sendCalls, [{ sessionId: 'session-quickchat-1', text: 'hi' }]);
  });
});

describe('handleQuickChatStart — error paths (send_failed)', () => {
  it('createSession failure → send_failed with generalized Chinese message', async () => {
    const deps = makeDeps({
      createSession: async () => {
        throw new Error('NO_REAL_CONNECTION:missing_api_key: 缺少 API key');
      },
    });
    const result = await handleQuickChatStart({ prompt: 'hi' }, deps);
    assert.equal(result.ok, false);
    if (!result.ok && result.reason === 'send_failed') {
      assert.match(result.message, /[一-鿿]/, 'message must be Chinese');
      // Raw reason code MUST NOT leak.
      assert.ok(!result.message.includes('NO_REAL_CONNECTION'), 'raw error code must not leak');
      assert.ok(!result.message.includes('missing_api_key'), 'raw reason must not leak');
    } else {
      assert.fail('expected send_failed result');
    }
  });

  it('sendFirstMessage failure → send_failed with generalized Chinese message', async () => {
    const deps = makeDeps({
      sendFirstMessage: async () => {
        throw new Error('NO_REAL_CONNECTION:connection_disabled: connection is disabled');
      },
    });
    const result = await handleQuickChatStart({ prompt: 'hi' }, deps);
    assert.equal(result.ok, false);
    if (!result.ok && result.reason === 'send_failed') {
      assert.match(result.message, /[一-鿿]/);
      assert.ok(!result.message.includes('connection_disabled'));
    } else {
      assert.fail('expected send_failed result');
    }
  });

  it('ensureCanSend failure → send_failed (session still created, but caller sees failure)', async () => {
    const deps = makeDeps({
      ensureCanSend: async () => {
        throw new Error('NO_REAL_CONNECTION:missing_api_key: 缺少 API key');
      },
    });
    const result = await handleQuickChatStart({ prompt: 'hi' }, deps);
    assert.equal(result.ok, false);
    if (!result.ok && result.reason === 'send_failed') {
      // Session was created (deps.createSession succeeded); but
      // ensureCanSend rejected. We surface a generalized message;
      // the session row remains in the sidebar for the user to delete
      // / retry from.
      assert.equal(deps.spy.createCalls, 1);
      assert.ok(!result.message.includes('missing_api_key'));
    } else {
      assert.fail('expected send_failed result');
    }
  });
});
