/**
 * Pure value-codec helpers backing the ChatModelSwitcher: group an
 * unsorted list of `ChatModelChoice`s by their connection, and
 * encode/decode the `<connection>:<model>` pair that becomes the
 * Select item value.
 *
 * PR-UI-LIB-EXTRACT-3 (WAWQAQ msg `510fef52`, round 4/10): pulled
 * out of `components.tsx`. `ChatModelChoice` itself was already
 * a public type (consumed by the renderer's main.tsx); the three
 * helpers were panel-internal. byte-for-byte equivalent; behavior
 * unchanged; `index.ts` re-exports the new module so the
 * `@maka/ui` public API surface stays identical.
 *
 * Why this seam: the encode/decode pair is the trust boundary
 * between Select-item string values and structured
 * `{ llmConnectionSlug, model }` records. Living next to ~600
 * lines of ChatModelSwitcher JSX made the codec hard to find and
 * impossible to unit-test in isolation — but it's exactly the
 * kind of pure boundary that benefits from a separate test
 * harness (URI-encoded delimiters, malformed input fall-through).
 */

import type { ProviderType } from '@maka/core';

export interface ChatModelChoice {
  connectionSlug: string;
  connectionLabel: string;
  providerType: ProviderType;
  model: string;
  /* PR-CHAT-MODEL-CHOICE-DROP-LABEL-0 (round 23/30): removed.
     PR-CHAT-CHROME-FIX-0 stopped rendering `choice.label` (the
     `${connection.name} · ${model}` string that leaked auth /
     email info into the model switcher). The field had no
     remaining consumers. */
}

export function groupModelChoices(choices: ChatModelChoice[]): Array<{
  connectionSlug: string;
  connectionLabel: string;
  choices: ChatModelChoice[];
}> {
  const bySlug = new Map<string, { connectionSlug: string; connectionLabel: string; choices: ChatModelChoice[] }>();
  for (const choice of choices) {
    const group = bySlug.get(choice.connectionSlug);
    if (group) {
      group.choices.push(choice);
    } else {
      bySlug.set(choice.connectionSlug, {
        connectionSlug: choice.connectionSlug,
        connectionLabel: choice.connectionLabel,
        choices: [choice],
      });
    }
  }
  return [...bySlug.values()];
}

export function modelChoiceValue(connectionSlug: string, model: string): string {
  return `${encodeURIComponent(connectionSlug)}:${encodeURIComponent(model)}`;
}

export function parseModelChoiceValue(value: string): { llmConnectionSlug: string; model: string } | undefined {
  const idx = value.indexOf(':');
  if (idx <= 0) return undefined;
  try {
    const llmConnectionSlug = decodeURIComponent(value.slice(0, idx));
    const model = decodeURIComponent(value.slice(idx + 1));
    if (!llmConnectionSlug || !model) return undefined;
    return { llmConnectionSlug, model };
  } catch {
    return undefined;
  }
}
