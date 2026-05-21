/**
 * Tests for the chat header alert derivation (P0 follow-up).
 *
 * Background: @WAWQAQ reported that after configuring Z.ai, sending a
 * message still pops "你没配置模型". Investigation showed three sessions
 * on disk in `~/Library/Application Support/Maka/workspaces/default/`:
 *   1. backend='claude' slug='fake-claude'  (legacy backend kind)
 *   2. backend='ai-sdk' slug='zai-coding-plan'  (correctly configured)
 *   3. backend='fake'   slug='fake'         (visual-smoke-style demo)
 *
 * Sessions 1 + 3 were silently rejected at send time by `assertSessionCanSend`
 * with `connection_missing` / `fake_backend` reasons respectively. The user
 * couldn't tell up-front which session they had focused.
 *
 * This test locks down the banner matrix so users see the broken state
 * BEFORE they hit send — and so the warning vs. destructive split tracks
 * whether @xuan's send-path silent rebind can save them or not.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  deriveChatHeaderAlert,
  type ChatHeaderAlertInput,
} from '../../renderer/chat-header-alert.js';

function input(partial: Partial<ChatHeaderAlertInput>): ChatHeaderAlertInput {
  return {
    backend: 'ai-sdk',
    hasActiveConnection: true,
    defaultConnectionReady: true,
    lastTestStatus: undefined,
    ...partial,
  };
}

describe('deriveChatHeaderAlert', () => {
  it('returns undefined when no active session', () => {
    const result = deriveChatHeaderAlert(input({ backend: undefined }));
    assert.equal(result, undefined);
  });

  it('returns undefined when session is healthy + connection present + no test issue', () => {
    const result = deriveChatHeaderAlert(input({}));
    assert.equal(result, undefined);
  });

  describe('legacy / stale fake backend (P0 root cause)', () => {
    it('warning when default is ready — send will silent-rebind', () => {
      const result = deriveChatHeaderAlert(
        input({ backend: 'fake', defaultConnectionReady: true }),
      );
      assert.equal(result?.tone, 'warning');
      assert.equal(result?.label, '会话已过期 · 发送时会切换到默认连接');
      assert.equal(result?.onClickTarget, 'models');
      // @kenji review: user shouldn't see "演示版" in the badge — it lives
      // in the tooltip so curious users can still find the technical reason.
      assert.match(result?.tooltip ?? '', /FakeBackend/);
    });

    it('destructive when no default ready — send will still fail', () => {
      const result = deriveChatHeaderAlert(
        input({ backend: 'fake', defaultConnectionReady: false }),
      );
      assert.equal(result?.tone, 'destructive');
      assert.equal(result?.label, '会话已过期 · 请先配置真实模型');
      assert.equal(result?.onClickTarget, 'models');
      assert.match(result?.tooltip ?? '', /设置.*模型/);
    });

    it('user-centric label never exposes "演示版" / "fake" terminology', () => {
      const ready = deriveChatHeaderAlert(
        input({ backend: 'fake', defaultConnectionReady: true }),
      );
      const notReady = deriveChatHeaderAlert(
        input({ backend: 'fake', defaultConnectionReady: false }),
      );
      assert.doesNotMatch(ready?.label ?? '', /演示版|fake|FakeBackend/i);
      assert.doesNotMatch(notReady?.label ?? '', /演示版|fake|FakeBackend/i);
    });

    it('takes priority over a missing-connection signal (a `fake` session also has no real connection)', () => {
      const result = deriveChatHeaderAlert(
        input({
          backend: 'fake',
          hasActiveConnection: false,
          defaultConnectionReady: true,
        }),
      );
      assert.equal(result?.label, '会话已过期 · 发送时会切换到默认连接');
    });

    it('lastTestStatus on a fake session is irrelevant — fake takes priority', () => {
      const result = deriveChatHeaderAlert(
        input({
          backend: 'fake',
          hasActiveConnection: true,
          lastTestStatus: 'verified',
          defaultConnectionReady: true,
        }),
      );
      assert.equal(result?.label, '会话已过期 · 发送时会切换到默认连接');
    });
  });

  describe('missing connection (deleted or legacy slug)', () => {
    it('warning when default ready', () => {
      const result = deriveChatHeaderAlert(
        input({
          backend: 'ai-sdk',
          hasActiveConnection: false,
          defaultConnectionReady: true,
        }),
      );
      assert.equal(result?.tone, 'warning');
      assert.equal(result?.label, '原连接已删除 · 发送时会切换到默认连接');
      assert.equal(result?.onClickTarget, 'models');
      assert.ok(result?.tooltip);
    });

    it('destructive when no default ready (preserves PR106 "连接已删除" copy)', () => {
      const result = deriveChatHeaderAlert(
        input({
          backend: 'ai-sdk',
          hasActiveConnection: false,
          defaultConnectionReady: false,
        }),
      );
      assert.equal(result?.tone, 'destructive');
      assert.equal(result?.label, '连接已删除');
      assert.equal(result?.onClickTarget, 'models');
      assert.match(result?.tooltip ?? '', /设置.*模型/);
    });

    it('handles legacy backend (e.g. "claude") missing connection — same banner', () => {
      const result = deriveChatHeaderAlert(
        input({
          backend: 'claude',
          hasActiveConnection: false,
          defaultConnectionReady: false,
        }),
      );
      assert.equal(result?.label, '连接已删除');
    });
  });

  describe('credential lifecycle on a present connection', () => {
    it('needs_reauth → warning · open account', () => {
      const result = deriveChatHeaderAlert(
        input({ lastTestStatus: 'needs_reauth' }),
      );
      assert.equal(result?.tone, 'warning');
      assert.equal(result?.label, '需要重新登录');
      assert.equal(result?.onClickTarget, 'account');
      assert.match(result?.tooltip ?? '', /401|403|鉴权/);
    });

    it('error → destructive · open account', () => {
      const result = deriveChatHeaderAlert(input({ lastTestStatus: 'error' }));
      assert.equal(result?.tone, 'destructive');
      assert.equal(result?.label, '上次连接失败');
      assert.equal(result?.onClickTarget, 'account');
      assert.match(result?.tooltip ?? '', /5xx|网络|超时|Base URL|代理/);
    });

    it('verified → no alert', () => {
      const result = deriveChatHeaderAlert(input({ lastTestStatus: 'verified' }));
      assert.equal(result, undefined);
    });
  });

  describe('priority order', () => {
    // The three concerns are checked in the order:
    //   1. Stale fake backend → fake banner
    //   2. Missing connection → missing-connection banner
    //   3. Connection test status → reauth / error
    //
    // We lock the order so a future change doesn't accidentally start
    // showing "needs_reauth" instead of "session is fake" when both apply.

    it('fake backend beats missing connection beats credential status', () => {
      const result = deriveChatHeaderAlert(
        input({
          backend: 'fake',
          hasActiveConnection: false,
          lastTestStatus: 'error',
          defaultConnectionReady: true,
        }),
      );
      assert.equal(result?.label, '会话已过期 · 发送时会切换到默认连接');
    });

    it('missing connection beats credential status', () => {
      const result = deriveChatHeaderAlert(
        input({
          backend: 'ai-sdk',
          hasActiveConnection: false,
          lastTestStatus: 'error',
          defaultConnectionReady: false,
        }),
      );
      assert.equal(result?.label, '连接已删除');
    });
  });
});
