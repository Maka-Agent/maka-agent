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
  /** Short label shown inside the badge — user-centric mental model. */
  label: string;
  /**
   * Longer explanation rendered as `title` (native tooltip) + screen
   * reader `aria-label`. Use this for the "why" details that don't
   * belong in the 1-line label — keeps badges scannable while
   * preserving full context for users who hover or use AT.
   */
  tooltip?: string;
  /** Which Settings section the click handler should navigate to. */
  onClickTarget: ChatHeaderAlertTarget;
}

export function deriveChatHeaderAlert(input: ChatHeaderAlertInput): DerivedChatHeaderAlert | undefined {
  if (input.backend === undefined) return undefined;

  // 1. Stale `fake` backend.
  //
  // @kenji copy review: don't expose "演示版" to the user. Their mental
  // model is "this is an old session that doesn't apply to my new Z.ai
  // setup" — surface it as "会话已过期", explain the technical detail
  // in the tooltip for users who want to know.
  if (input.backend === 'fake') {
    return input.defaultConnectionReady
      ? {
          tone: 'warning',
          label: '会话已过期 · 发送时会切换到默认连接',
          tooltip: '原会话使用演示 backend (FakeBackend)，发送时会自动切换到当前默认连接。',
          onClickTarget: 'models',
        }
      : {
          tone: 'destructive',
          label: '会话已过期 · 请先配置真实模型',
          tooltip: '原会话使用演示 backend (FakeBackend)，需要先到 设置 · 模型 添加并启用一个真实模型才能发送。',
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
          tooltip: '此会话依赖的模型连接已被删除或重命名。发送时会自动切换到当前默认连接。',
          onClickTarget: 'models',
        }
      : {
          tone: 'destructive',
          label: '连接已删除',
          tooltip: '此会话依赖的模型连接已被删除，且尚未配置默认连接。请到 设置 · 模型 添加一个可用的模型。',
          onClickTarget: 'models',
        };
  }

  // 3. Credential lifecycle states on a present connection.
  if (input.lastTestStatus === 'needs_reauth') {
    return {
      tone: 'warning',
      label: '需要重新登录',
      tooltip: '上次连接测试返回鉴权失败（401 / 403）。可能 API key 已过期或被吊销，请到 设置 · 账号 重新设置。',
      onClickTarget: 'account',
    };
  }
  if (input.lastTestStatus === 'error') {
    return {
      tone: 'destructive',
      label: '上次连接失败',
      tooltip: '上次连接测试因网络 / 超时 / 5xx 失败。请到 设置 · 账号 重新测试或检查 Base URL / 代理。',
      onClickTarget: 'account',
    };
  }
  return undefined;
}
