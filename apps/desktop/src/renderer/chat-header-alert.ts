/**
 * Pure derivation of the chat header's connection-lifecycle alert badge.
 *
 * Lives outside the React component so it can be unit-tested without a DOM
 * (mirrors the `connection-status.ts` pattern). The renderer wraps the
 * returned `onClickTarget` into a Settings-jump click handler — keeping the
 * pure function free of side effects + UI navigation lets us pin the alert
 * matrix down with node:test.
 *
 * Priority order (most specific first):
 *
 *   1. Active session uses `backend='fake'` (visual smoke fixture or a
 *      legacy session from before the chat-readiness gate landed). With
 *      send-path silent rebind in place, this is a "heads up" warning when
 *      a real default is ready, but a hard "无法发送" block when nothing
 *      is configured.
 *   2. Active session references a connection that no longer exists
 *      (deleted from Settings · 模型 while the chat was open, OR legacy
 *      sessions with slugs like `fake-claude` from removed backend kinds).
 *      Same warning/destructive split based on whether a default is ready.
 *   3. The active connection is in `needs_reauth` (warning) or `error`
 *      (destructive) — credential lifecycle states surfaced from the
 *      backend test result.
 *
 * Everything else → no alert badge.
 */

export interface ChatHeaderAlertInput {
  /**
   * The session backend kind. `'fake'` is treated as stale because the
   * FakeBackend is for dev/demo only — once the user configures a real
   * provider, any pre-existing `fake` session is a relic.
   *
   * `string` (not `BackendKind`) so legacy on-disk values like `'claude'`
   * (a removed backend) are surfaced exactly as the JSONL stored them.
   */
  backend: string | undefined;
  /**
   * True when the session's `llmConnectionSlug` resolves to a real
   * connection in the current store. False = either deleted or legacy.
   */
  hasActiveConnection: boolean;
  /**
   * True when there's a default connection in the store AND it's enabled.
   * Cheap renderer-side proxy for "send-path silent rebind can succeed" —
   * the backend remains authoritative if the API key is missing (will
   * raise `missing_api_key` at send time).
   */
  defaultConnectionReady: boolean;
  /**
   * Result of the most recent credential test for the active connection.
   * `needs_reauth` (401/403) → warning; `error` (5xx/timeout/network) →
   * destructive. Only meaningful when `hasActiveConnection` is true.
   */
  lastTestStatus: 'verified' | 'needs_reauth' | 'error' | undefined;
}

export type ChatHeaderAlertTarget = 'models' | 'account';

export interface DerivedChatHeaderAlert {
  tone: 'info' | 'warning' | 'destructive';
  label: string;
  /** Which Settings section the click handler should navigate to. */
  onClickTarget: ChatHeaderAlertTarget;
}

export function deriveChatHeaderAlert(input: ChatHeaderAlertInput): DerivedChatHeaderAlert | undefined {
  if (input.backend === undefined) return undefined;

  // 1. Stale `fake` backend.
  //
  // Even though the type system says `BackendKind = 'ai-sdk' | 'fake'`, we
  // treat 'fake' as "this session can't reach a real provider on its own"
  // regardless of whether the user manually picked it or got it from a
  // pre-readiness-gate legacy state.
  if (input.backend === 'fake') {
    return input.defaultConnectionReady
      ? {
          tone: 'warning',
          label: '此会话为演示版 · 发送时会切换到默认连接',
          onClickTarget: 'models',
        }
      : {
          tone: 'destructive',
          label: '此会话为演示版 · 请先配置真实模型',
          onClickTarget: 'models',
        };
  }

  // 2. Connection missing (or legacy `claude` backend with slug like
  // `fake-claude` that never had a real ConnectionStore entry).
  if (!input.hasActiveConnection) {
    return input.defaultConnectionReady
      ? {
          tone: 'warning',
          label: '原连接已删除 · 发送时会切换到默认连接',
          onClickTarget: 'models',
        }
      : {
          tone: 'destructive',
          label: '连接已删除',
          onClickTarget: 'models',
        };
  }

  // 3. Credential lifecycle states on a present connection.
  if (input.lastTestStatus === 'needs_reauth') {
    return {
      tone: 'warning',
      label: '需要重新登录',
      onClickTarget: 'account',
    };
  }
  if (input.lastTestStatus === 'error') {
    return {
      tone: 'destructive',
      label: '上次连接失败',
      onClickTarget: 'account',
    };
  }
  return undefined;
}
