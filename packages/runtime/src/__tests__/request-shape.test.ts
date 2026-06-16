import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeToolSet } from '../request-shape.js';
import type { MakaTool } from '../tool-runtime.js';

function tool(name: string, exposure?: 'direct' | 'deferred'): MakaTool {
  return {
    name,
    description: name,
    parameters: {},
    impl: () => ({}),
    ...(exposure ? { exposure } : {}),
  };
}

const invalid = tool('invalid');

describe('canonicalizeToolSet exposure gating', () => {
  test('direct tools are active; a deferred tool is excluded when not loaded', () => {
    const { activeTools } = canonicalizeToolSet(
      [tool('Read'), tool('Rive', 'deferred'), tool('load_tool')],
      invalid,
    );
    assert.ok(activeTools.includes('Read'), 'direct Read should be active');
    assert.ok(activeTools.includes('load_tool'), 'load_tool should be active');
    assert.ok(!activeTools.includes('Rive'), 'unloaded deferred Rive should be hidden');
  });

  test('a deferred tool becomes active once it is in the loaded set', () => {
    const { activeTools } = canonicalizeToolSet(
      [tool('Read'), tool('Rive', 'deferred')],
      invalid,
      new Set(['Rive']),
    );
    assert.ok(activeTools.includes('Rive'), 'loaded deferred Rive should be active');
  });

  test('providerTools keeps the full registry for dispatch; invalid present but not advertised', () => {
    const { providerTools, activeTools } = canonicalizeToolSet(
      [tool('Read'), tool('Rive', 'deferred')],
      invalid,
    );
    const names = providerTools.map((t) => t.name);
    assert.ok(names.includes('Read'));
    assert.ok(names.includes('Rive'), 'deferred tool stays dispatchable in providerTools');
    assert.ok(names.includes('invalid'), 'repair target present in providerTools');
    assert.ok(!activeTools.includes('invalid'), 'invalid is never advertised to the model');
  });

  test('omitting exposure means direct (backward compatible), names sorted', () => {
    const { activeTools } = canonicalizeToolSet([tool('Write'), tool('Read')], invalid);
    assert.deepEqual(activeTools, ['Read', 'Write']);
  });
});
