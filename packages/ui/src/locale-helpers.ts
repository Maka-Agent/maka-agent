/**
 * UI locale detection + prompt-suggestion copy.
 *
 * PR-UI-LIB-EXTRACT-5 (WAWQAQ msg `510fef52`, round 6/10): pulled
 * out of `components.tsx`. `detectUiLocale`, `UiLocale`, and
 * `getPromptSuggestions` were already public exports from
 * `@maka/ui` (consumed by the renderer's main.tsx, OnboardingHero,
 * theme.ts, visual-smoke fixture, and the
 * text-file-import contract test); `PROMPT_SUGGESTIONS_BY_LOCALE`,
 * `PromptSuggestion`, and `PromptSuggestionLocale` were
 * panel-internal. byte-for-byte equivalent; behavior unchanged;
 * `index.ts` re-exports the new module so the public API surface
 * stays identical.
 *
 * Why this seam (round 6 follow-up to round 5):
 *   1. Locale detection is the single source of truth referenced
 *      by SO many surfaces (chat empty-hero, composer placeholders,
 *      onboarding hero, Intl.DateTimeFormat language) that giving
 *      it its own home is the natural cut.
 *   2. Round 5 introduced a deliberate ESM circular import — the
 *      new `chat-display-helpers.ts` needed `detectUiLocale` from
 *      `components.tsx`, while `components.tsx` imports its time
 *      formatters from `chat-display-helpers.ts`. Safe but ugly.
 *      Moving `detectUiLocale` here breaks the cycle: both
 *      `components.tsx` and `chat-display-helpers.ts` now depend on
 *      this leaf module, with no edges between them in this
 *      dimension.
 */

/**
 * Internal locale family used by prompt-suggestion mapping. Kept
 * private to this module; consumers use the public `UiLocale`
 * alias below.
 */
type PromptSuggestionLocale = 'zh' | 'en';

export type PromptSuggestion = { label: string; prompt: string };

/**
 * PR-UI-14 (@yuejing 2026-05-22): locale-aware prompt suggestions.
 *
 * Audit §3.7 — the v1 chip set was 6 dev-heavy zh prompts (code review,
 * unit tests, debugging…). Two problems:
 *   1. English-locale users saw a wall of Chinese chips on first run.
 *   2. Non-developer users (PMs, writers, students) saw nothing
 *      universally relevant — the chips read as "Maka is only for
 *      programmers".
 *
 * Fix: detect locale family (zh / en) via `navigator.language` and
 * return a balanced mix of dev + general starting points. Each locale
 * keeps 3 dev chips (codebase summary / explain code / Code review)
 * for the power-user path and adds 3 general chips (read a long doc,
 * translate, draft a message) so the empty-chat surface reads as a
 * general assistant first, a coding assistant second.
 */
const PROMPT_SUGGESTIONS_BY_LOCALE: Record<PromptSuggestionLocale, PromptSuggestion[]> = {
  zh: [
    { label: '总结代码库', prompt: '帮我总结当前代码库的目录结构和关键模块。' },
    { label: '解释这段代码', prompt: '我贴一段代码进来，请帮我逐行解释它做什么、有没有坑：\n\n```\n\n```' },
    { label: '读一份长文', prompt: '我贴一篇文章/文档过来，请帮我提炼核心观点、列出关键事实、找出我可能漏看的地方：\n\n' },
    { label: '翻译并润色', prompt: '把下面这段翻译成英文，保持原意，语气专业自然：\n\n' },
    { label: '起草一条消息', prompt: '帮我起草一条 ____ 风格的消息，对象是 ____，目的是 ____：\n\n要点：\n- \n- ' },
    { label: '代码审查', prompt: '请帮我审查这段代码，重点关注可读性、错误处理和潜在性能问题：\n\n```\n\n```' },
  ],
  en: [
    { label: 'Summarize codebase', prompt: 'Help me map this codebase: directory layout, key modules, and how they fit together.' },
    { label: 'Explain code', prompt: 'Paste a snippet — explain it line by line and flag any pitfalls:\n\n```\n\n```' },
    { label: 'Read a long doc', prompt: 'Here\'s an article or doc — pull out the core argument, list the key facts, and tell me what I might be missing:\n\n' },
    { label: 'Translate & polish', prompt: 'Translate the text below into Chinese; keep the meaning, tone should stay natural and professional:\n\n' },
    { label: 'Draft message', prompt: 'Help me draft a ____ message to ____, with the goal of ____:\n\nPoints to cover:\n- \n- ' },
    { label: 'Review code', prompt: 'Please review this code — readability, error handling, performance concerns:\n\n```\n\n```' },
  ],
};

/**
 * Detects the renderer-side UI locale family. Used by EmptyChatHero
 * chips + hero copy (PR-UI-14) and Composer / OnboardingHero quickChat
 * placeholders (PR-UI-15). Centralized here so all UI surfaces fall
 * onto the same `zh` / `en` split — there's no per-component drift.
 */
export type UiLocale = PromptSuggestionLocale;

export function detectUiLocale(): UiLocale {
  if (typeof document !== 'undefined') {
    // Precedence (highest to lowest), per kenji `7e532892` +
    // xuan `54b56858` acceptance criteria:
    //   1. visual-smoke fixture override (deterministic baselines).
    //   2. user preference (PR-LANG-PREF-0): persisted in
    //      `personalization.uiLocale`; the renderer mirrors a
    //      resolved-value attribute (`data-maka-locale="zh|en"`)
    //      to `<html>` on mount and on every settings save so we
    //      can read it synchronously here without an async
    //      settings round-trip.
    //   3. Chinese-first product fallback. Most app chrome is already
    //      Chinese, and Electron's `navigator.language` can be `en-US`
    //      on this dev machine, which produced a visibly mixed shell.
    //
    // Real users can still choose English explicitly in Settings; `auto`
    // should not make the default Chinese shell read half-English.
    const smokeOverride = document.documentElement.dataset.makaVisualSmokeLocale;
    if (smokeOverride === 'zh' || smokeOverride === 'en') return smokeOverride;
    const userPref = document.documentElement.dataset.makaLocale;
    if (userPref === 'zh' || userPref === 'en') return userPref;
  }
  return 'zh';
}

export function getPromptSuggestions(locale?: UiLocale): PromptSuggestion[] {
  return PROMPT_SUGGESTIONS_BY_LOCALE[locale ?? detectUiLocale()];
}
