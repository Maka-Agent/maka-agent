/**
 * PR-CHAT-MODEL-CHOICE-CONTRACT-TEST-0 (round 24/30): lock the
 * round-23 chrome-fix invariant in place. Background:
 *
 *   PR-CHAT-CHROME-FIX-0 (WAWQAQ msg `ccce4a31`) — "切换模型，你
 *   显示这么一堆干嘛？显示Model name就行了啊" — stopped rendering
 *   `choice.label` (a `${connection.name} · ${model}` string that
 *   leaked auth method + email into the model switcher).
 *
 *   PR-CHAT-MODEL-CHOICE-DROP-LABEL-0 (round 23) then removed the
 *   `label` field from the `ChatModelChoice` interface entirely and
 *   stopped writing it in `buildChatModelChoices`. Without a
 *   contract test, a future refactor could silently reintroduce
 *   the leak (the `label` would render again the moment any UI
 *   surface chooses to display it).
 *
 * This test pins:
 *   1. `ChatModelChoice` interface has exactly 3 fields
 *      (connectionSlug, providerType, model); neither `label` nor the
 *      former `connectionLabel` (also a leak) is among them.
 *   2. `buildChatModelChoices` does not push a `label:` line into
 *      the choice object.
 *   3. The model switcher items map only `choice.model` to `label`,
 *      not any composite string built from connection name + email
 *      + provider type.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

describe('PR-CHAT-MODEL-CHOICE-CONTRACT-TEST-0', () => {
  it('ChatModelChoice has no `label` field', async () => {
    const helpers = await readFile(
      resolve(REPO_ROOT, 'packages/ui/src/chat-model-helpers.ts'),
      'utf8',
    );

    // Grab the interface body and check each field.
    const interfaceMatch = helpers.match(
      /export interface ChatModelChoice \{([\s\S]*?)\n\}/,
    );
    assert.ok(interfaceMatch, 'ChatModelChoice interface must exist');
    const body = interfaceMatch[1];

    // Strip block comments before counting fields — round 23 left
    // a tombstone comment explaining why `label` was removed.
    const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '');

    const fieldNames = stripped
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//') && !line.startsWith('*'))
      .map((line) => line.match(/^(\w+)\??:/)?.[1])
      .filter((name): name is string => Boolean(name));

    assert.deepEqual(
      [...fieldNames].sort(),
      ['connectionSlug', 'model', 'providerType'],
      'ChatModelChoice must have exactly 3 fields and no `label`/`connectionLabel`',
    );
    assert.ok(
      !fieldNames.includes('label') && !fieldNames.includes('connectionLabel'),
      '`label`/`connectionLabel` must stay removed (either would leak auth method + email)',
    );
  });

  it('buildChatModelChoices does not write a `label` field', async () => {
    const renderer = await readFile(
      resolve(REPO_ROOT, 'apps/desktop/src/renderer/main.tsx'),
      'utf8',
    );

    const fnMatch = renderer.match(
      /function buildChatModelChoices\([\s\S]*?\n\}/,
    );
    assert.ok(fnMatch, 'buildChatModelChoices must exist');
    const fnBody = fnMatch[0];

    // Strip block comments — the function carries a tombstone
    // comment from round 23 that explicitly mentions `label:`.
    const stripped = fnBody.replace(/\/\*[\s\S]*?\*\//g, '');

    assert.ok(
      !/\blabel\s*:/.test(stripped),
      'buildChatModelChoices must not push a `label:` field into choices',
    );
  });

  it('model switcher items render only `choice.model`, not a composite label', async () => {
    // The switcher/picker JSX was extracted out of `components.tsx` into
    // `chat-model-switcher.tsx`; the SelectItem mapping lives there now.
    const ui = await readFile(
      resolve(REPO_ROOT, 'packages/ui/src/chat-model-switcher.tsx'),
      'utf8',
    );

    // The SelectItem mapping must use `choice.model` as the label,
    // not `${choice.connectionLabel} · ${choice.model}` or similar.
    assert.match(
      ui,
      /...props\.choices\.map\(\(choice\) => \(\{\s*value: modelChoiceValue\(choice\.connectionSlug, choice\.model\),\s*label: choice\.model,\s*\}\)\),/,
      'switcher items must map label directly to choice.model — no composite string',
    );
  });
});
