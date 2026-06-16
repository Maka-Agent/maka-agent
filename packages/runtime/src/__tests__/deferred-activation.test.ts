import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  loadedNamespacesFromSteps,
  computeActiveTools,
  buildDeferredPrepareStep,
  type StepLike,
} from '../deferred-activation.js';
import type { DeferredToolCatalog } from '../load-tool.js';
import type { MakaTool } from '../tool-runtime.js';

function tool(name: string, exposure?: 'direct' | 'deferred'): MakaTool {
  return { name, description: name, parameters: {}, impl: () => ({}), ...(exposure ? { exposure } : {}) };
}

const tools: MakaTool[] = [
  tool('Read'),
  tool('load_tool'),
  tool('RiveWorkflow', 'deferred'),
  tool('browser_navigate', 'deferred'),
  tool('browser_click', 'deferred'),
];
const invalid = tool('invalid');
const catalog: DeferredToolCatalog = [
  { namespace: 'rive', summary: 'Rive', toolNames: ['RiveWorkflow'] },
  { namespace: 'browser', summary: 'Browser', toolNames: ['browser_navigate', 'browser_click'] },
];

describe('loadedNamespacesFromSteps', () => {
  test('extracts namespaces from load_tool calls and ignores other tools', () => {
    const steps: StepLike[] = [
      { toolCalls: [{ toolName: 'Read', input: {} }, { toolName: 'load_tool', input: { namespace: 'rive' } }] },
      { toolCalls: [{ toolName: 'load_tool', input: { namespace: 'browser' } }] },
    ];
    assert.deepEqual([...loadedNamespacesFromSteps(steps)].sort(), ['browser', 'rive']);
  });

  test('parses a stringified input and ignores malformed/empty input', () => {
    const steps: StepLike[] = [
      { toolCalls: [{ toolName: 'load_tool', input: JSON.stringify({ namespace: 'rive' }) }] },
      { toolCalls: [{ toolName: 'load_tool', input: 'not json' }] },
      { toolCalls: [{ toolName: 'load_tool', input: {} }] },
    ];
    assert.deepEqual([...loadedNamespacesFromSteps(steps)], ['rive']);
  });

  test('undefined/empty steps yield an empty set', () => {
    assert.equal(loadedNamespacesFromSteps(undefined).size, 0);
    assert.equal(loadedNamespacesFromSteps([]).size, 0);
  });
});

describe('computeActiveTools (per-step active set)', () => {
  test('step 0 with no prior steps: direct + load_tool only, deferred hidden', () => {
    const active = computeActiveTools({ tools, invalidTool: invalid, catalog }, []);
    assert.ok(active.includes('Read'));
    assert.ok(active.includes('load_tool'));
    assert.ok(!active.includes('RiveWorkflow'));
    assert.ok(!active.includes('browser_navigate'));
  });

  test('after a load_tool(rive) call, RiveWorkflow is active; browser stays hidden', () => {
    const steps: StepLike[] = [{ toolCalls: [{ toolName: 'load_tool', input: { namespace: 'rive' } }] }];
    const active = computeActiveTools({ tools, invalidTool: invalid, catalog }, steps);
    assert.ok(active.includes('RiveWorkflow'));
    assert.ok(!active.includes('browser_navigate'));
  });

  test('loading the browser namespace activates the whole group at once', () => {
    const steps: StepLike[] = [{ toolCalls: [{ toolName: 'load_tool', input: { namespace: 'browser' } }] }];
    const active = computeActiveTools({ tools, invalidTool: invalid, catalog }, steps);
    assert.ok(active.includes('browser_navigate'));
    assert.ok(active.includes('browser_click'));
  });

  test('seedNamespaces (cross-turn ratchet) activate without a step call', () => {
    const active = computeActiveTools(
      { tools, invalidTool: invalid, catalog, seedNamespaces: new Set(['rive']) },
      [],
    );
    assert.ok(active.includes('RiveWorkflow'));
  });

  test('emits the active snapshot for the execute-boundary guard', () => {
    let snap: ReadonlySet<string> | undefined;
    computeActiveTools(
      { tools, invalidTool: invalid, catalog, onActiveSnapshot: (s) => { snap = s; } },
      [],
    );
    assert.ok(snap?.has('Read'));
    assert.ok(!snap?.has('RiveWorkflow'));
  });
});

describe('buildDeferredPrepareStep', () => {
  test('yields a prepareStep whose activeTools grows as load_tool calls accumulate', () => {
    const prep = buildDeferredPrepareStep({ tools, invalidTool: invalid, catalog });
    assert.ok(!prep({ steps: [] }).activeTools.includes('RiveWorkflow'));
    const after = prep({ steps: [{ toolCalls: [{ toolName: 'load_tool', input: { namespace: 'rive' } }] }] });
    assert.ok(after.activeTools.includes('RiveWorkflow'));
  });
});
