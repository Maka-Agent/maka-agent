/**
 * Pure helpers backing the Composer panel's draft + history behavior.
 *
 * PR-UI-LIB-EXTRACT-1 (WAWQAQ msg `510fef52`, round 2/10): pulled
 * out of the 8500-line `components.tsx` kitchen-sink. All five
 * helpers were already exported from `@maka/ui` (consumed by the
 * desktop renderer's OnboardingHero, plus four contract tests), so
 * this is a file-level seam — the public API is unchanged: the
 * package index re-exports the helpers from this module instead of
 * from `components.tsx`. byte-for-byte equivalent, zero behavior
 * change.
 *
 * Why: composer draft / history state is pure data manipulation
 * (Map + array slicing) and benefits from being testable without
 * booting the JSX surface. Keeping it next to the giant Composer
 * `forwardRef` made it impossible to read either the helpers OR the
 * panel in isolation.
 */

/**
 * Maximum number of characters retained for a single draft. Drafts
 * that grow past this limit keep only the trailing window so the
 * user's most recent typing survives an accidental tab close.
 */
const COMPOSER_DRAFT_MAX_CHARS = 120_000;

/**
 * Maximum number of distinct draft keys retained. Oldest entries
 * are evicted in insertion order when this is exceeded.
 */
const COMPOSER_DRAFT_MAX_ENTRIES = 32;

/**
 * Maximum number of history entries retained in the
 * up-arrow / down-arrow recall list.
 */
const COMPOSER_HISTORY_MAX_ENTRIES = 50;

export interface ComposerHistoryState {
  entries: string[];
  index: number;
  savedDraft: string;
}

export function appendPromptContextDraft(current: string, fragment: string): string {
  const base = current.trimEnd();
  const next = fragment.trim();
  if (!base) return next;
  if (!next) return base;
  return `${base}\n\n${next}`;
}

export function rememberComposerDraft(store: Map<string, string>, key: string | undefined, value: string): void {
  if (!key) return;
  const trimmed = value.trim();
  if (!trimmed) {
    store.delete(key);
    return;
  }

  const bounded = value.length > COMPOSER_DRAFT_MAX_CHARS
    ? value.slice(value.length - COMPOSER_DRAFT_MAX_CHARS)
    : value;
  store.delete(key);
  store.set(key, bounded);

  while (store.size > COMPOSER_DRAFT_MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (typeof oldest !== 'string') break;
    if (oldest === key && store.size === 1) break;
    store.delete(oldest);
  }
}

export function readComposerDraft(store: Map<string, string>, key: string | undefined): string {
  if (!key) return '';
  return store.get(key) ?? '';
}

export function rememberComposerHistoryEntry(entries: string[], text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return entries;
  const next = entries.filter((entry) => entry !== trimmed);
  next.push(trimmed);
  if (next.length > COMPOSER_HISTORY_MAX_ENTRIES) {
    return next.slice(next.length - COMPOSER_HISTORY_MAX_ENTRIES);
  }
  return next;
}

export function navigateComposerHistory(
  state: ComposerHistoryState,
  direction: 'previous' | 'next',
  currentValue: string,
): { state: ComposerHistoryState; value: string; changed: boolean } {
  if (state.entries.length === 0) return { state, value: currentValue, changed: false };

  if (direction === 'previous') {
    const savedDraft = state.index < 0 ? currentValue : state.savedDraft;
    const index = state.index < 0
      ? state.entries.length - 1
      : Math.max(0, state.index - 1);
    return {
      state: { entries: state.entries, index, savedDraft },
      value: state.entries[index] ?? currentValue,
      changed: true,
    };
  }

  if (state.index < 0) return { state, value: currentValue, changed: false };
  const index = state.index + 1;
  if (index >= state.entries.length) {
    return {
      state: { entries: state.entries, index: -1, savedDraft: '' },
      value: state.savedDraft,
      changed: true,
    };
  }
  return {
    state: { entries: state.entries, index, savedDraft: state.savedDraft },
    value: state.entries[index] ?? currentValue,
    changed: true,
  };
}
