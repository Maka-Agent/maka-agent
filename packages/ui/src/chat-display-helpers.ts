/**
 * Small pure helpers backing the chat surface (TurnView,
 * RelativeTime, MessageMeta, StreamingAssistantBubble, etc.) —
 * time formatters, role/avatar label derivation, turn duration +
 * abort marker copy.
 *
 * PR-UI-LIB-EXTRACT-4 (round 5/10) introduced this module with a
 * deliberate ESM circular import on `./components.js` for
 * `detectUiLocale`. PR-UI-LIB-EXTRACT-5 (round 6/10) broke the
 * cycle by lifting `detectUiLocale` into a new `locale-helpers`
 * leaf module; this file now depends on that leaf instead.
 *
 * Why this seam: avatar/initial derivation has Unicode codepoint
 * subtleties (emoji vs CJK vs Latin), duration formatting has
 * ms→s→m bucket rules, and the abort-marker label is i18n-able
 * copy. Each rule was previously buried between TurnView's 200-
 * line JSX block and StreamingAssistantBubble's stream-snap
 * hookup; the bundle now sits as 6 short pure functions easy to
 * unit-test in isolation.
 */

import { detectUiLocale } from './locale-helpers.js';

export function createAbsoluteTimeFormat(): Intl.DateTimeFormat {
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
    return { format: (d: Date) => d.toISOString() } as unknown as Intl.DateTimeFormat;
  }
  return new Intl.DateTimeFormat(
    detectUiLocale() === 'en' ? 'en' : 'zh-CN',
    { dateStyle: 'medium', timeStyle: 'short' },
  );
}

export function formatAbsoluteTimestamp(ts: number): string {
  return createAbsoluteTimeFormat().format(new Date(ts));
}

export function messageRoleLabel(role: string, userLabel?: string): string {
  if (role === 'user') {
    const trimmed = userLabel?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : '你';
  }
  if (role === 'assistant') return 'Maka';
  return role;
}

/**
 * Initial-glyph derivation for the message avatar. Uses the first non-ASCII
 * codepoint or first ASCII letter so a userLabel like "JK" → "J", a Chinese
 * userLabel like "用户" → "用", an emoji name like "🦊 fox" → "🦊".
 */
export function avatarInitial(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) return '你';
  // Pull the first codepoint so we don't slice an emoji surrogate pair.
  const [first] = trimmed;
  return first ?? '?';
}

export function formatTurnDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m} m ${s} s`;
}

export function turnAbortMarkerLabel(abortSource: string | undefined): string {
  switch (abortSource) {
    case 'renderer.stop_button': return '(已中断 · 由停止按钮触发)';
    default: return '(已中断)';
  }
}
