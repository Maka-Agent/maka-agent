import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ModelMessage } from 'ai';
import type { RuntimeEvent } from '@maka/core/runtime-event';

import {
  activeFullCompactBlockToCompactionBoundary,
  activeFullCompactCoverageFromEntries,
  activeFullCompactDecisionDiagnosticPatch,
  buildDeterministicActiveFullCompactSummary,
  buildActiveFullCompactBlockFromSummary,
  buildActiveFullCompactSourceIndex,
  renderActiveFullCompactBlock,
  rewriteActiveFullCompactInMessages,
  selectActiveFullCompactCoveredSpan,
  validateActiveFullCompactBlockForSourceIndex,
  validateActiveFullCompactBlockShape,
  type ActiveFullCompactFailOpenReason,
  type ActiveFullCompactSummary,
  type ActiveFullCompactValidationResult,
} from '../active-full-compact.js';
import {
  ACTIVE_ARCHIVED_TOOL_RESULT_PLACEHOLDER_KIND,
  ARCHIVED_TOOL_RESULT_REWRITE_VERSION,
  type ActiveArchivedToolResultPlaceholder,
} from '../context-budget.js';

describe('active full compact PR1 foundation', () => {
  test('source index maps RuntimeEvents to provider entries', () => {
    const runtimeEvents = fixtureRuntimeEvents();
    const messages = fixtureMessages();
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runId: 'run-1',
      invocationId: 'inv-1',
      messages,
      runtimeEvents,
      stepNumber: 2,
      charsPerToken: 2,
    });

    assert.equal(index.entries.length, 3);
    assert.deepEqual(
      index.entries.map((entry) => entry.runtimeEventId),
      ['event-user', 'event-call', 'event-response'],
    );
    assert.deepEqual(
      index.entries.map((entry) => entry.contentKind),
      ['text', 'function_call', 'function_response'],
    );
    const response = index.entries[2]!;
    assert.equal(response.toolCallId, 'call-1');
    assert.equal(response.toolName, 'Read');
    assert.match(response.bodySha256, /^[a-f0-9]{64}$/);
    assert.ok(response.estimatedTokens > 0);
  });

  test('source index recognizes active prune placeholders', () => {
    const placeholder = activePlaceholder();
    const messages: ModelMessage[] = [{
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-archived',
        toolName: 'Bash',
        output: { type: 'text', value: JSON.stringify(placeholder) },
      }],
    } as unknown as ModelMessage];

    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
      charsPerToken: 1,
    });

    const entry = index.entries[0]!;
    assert.equal(entry.contentKind, 'active_archive_placeholder');
    assert.equal(entry.archiveRef?.kind, 'toolResult');
    assert.equal(entry.archiveRef?.artifactId, 'artifact-call-archived');
    assert.equal(entry.archiveRef?.bodySha256, placeholder.bodySha256);
    assert.equal(entry.originalEstimatedTokens, 123);
    assert.equal(entry.originalBytes, 456);
    assert.equal(entry.toolCallId, 'call-archived');
  });

  test('coverage derives stable ids and hashes', () => {
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages: fixtureMessages(),
      runtimeEvents: fixtureRuntimeEvents(),
    });

    const coverage = activeFullCompactCoverageFromEntries([...index.entries].reverse());

    assert.deepEqual(coverage.runtimeEventIds, ['event-call', 'event-response', 'event-user']);
    assert.deepEqual(coverage.providerMessageSourceIds, ['provider:0', 'provider:1:0', 'provider:2:0']);
    assert.deepEqual(coverage.toolCallIds, ['call-1']);
    assert.deepEqual(coverage.contentKinds, ['function_call', 'function_response', 'text']);
    assert.equal(coverage.bodySha256.length, 3);
  });

  test('block builder, renderer, and shape validator work', () => {
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages: fixtureMessages(),
      runtimeEvents: fixtureRuntimeEvents(),
    });
    const summary = fixtureSummary(index.entries.map((entry) => entry.sourceId));
    const block = buildActiveFullCompactBlockFromSummary({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runId: 'run-1',
      invocationId: 'inv-1',
      entries: index.entries,
      summary,
      highWaterName: 'test-active-full-compact',
      highWaterSeq: 7,
      now: 100,
    });
    const sameBlock = buildActiveFullCompactBlockFromSummary({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runId: 'run-1',
      invocationId: 'inv-1',
      entries: index.entries,
      summary,
      highWaterName: 'test-active-full-compact',
      highWaterSeq: 7,
      now: 200,
    });

    assert.equal(block.blockId, sameBlock.blockId);
    assert.equal(validateActiveFullCompactBlockShape(block, 'session-1'), true);
    const rendered = renderActiveFullCompactBlock(block);
    assert.match(rendered, /<maka_active_full_compact_block/);
    assert.match(rendered, /commands_tried:/);
    assert.doesNotMatch(rendered, /SECRET_RAW_OUTPUT/);
  });

  test('block-to-boundary mapping uses shared vocabulary', () => {
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages: fixtureMessages(),
      runtimeEvents: fixtureRuntimeEvents(),
    });
    const block = buildActiveFullCompactBlockFromSummary({
      sessionId: 'session-1',
      turnId: 'turn-1',
      entries: index.entries,
      summary: fixtureSummary(index.entries.map((entry) => entry.sourceId)),
      preservedAnchor: {
        tailRuntimeEventIds: ['event-response'],
        tailProviderMessageSourceIds: ['provider:2:0'],
        tailTurnIds: ['turn-1'],
      },
      now: 100,
    });

    const boundary = activeFullCompactBlockToCompactionBoundary(block, {
      validationStatus: 'valid',
      validationReason: 'ok',
    });

    assert.equal(boundary.kind, 'activeFullCompact');
    assert.equal(boundary.stage, 'activeStep');
    assert.equal(boundary.boundaryId, block.blockId);
    assert.deepEqual(boundary.coverage.runtimeEventIds, block.coverage.runtimeEventIds);
    assert.deepEqual(boundary.sourceHashes, block.coverage.bodySha256);
    assert.equal(boundary.validationStatus, 'valid');
    assert.match(boundary.renderedText ?? '', /providerSourceIds=/);
    assert.deepEqual(boundary.preservedAnchor?.tailProviderMessageSourceIds, ['provider:2:0']);
  });

  test('validation fails open on source hash mismatch and maps diagnostics', () => {
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages: fixtureMessages(),
      runtimeEvents: fixtureRuntimeEvents(),
    });
    const block = buildActiveFullCompactBlockFromSummary({
      sessionId: 'session-1',
      turnId: 'turn-1',
      entries: index.entries,
      summary: fixtureSummary(index.entries.map((entry) => entry.sourceId)),
      now: 100,
    });
    block.coverage.bodySha256 = ['bad-hash'];

    const validation = validateActiveFullCompactBlockForSourceIndex(block, index);
    assert.equal(validation.valid, false);
    assert.deepEqual(validation.reasons, ['source_hash_mismatch']);

    const patch = activeFullCompactDecisionDiagnosticPatch({
      decision: 'failedOpen',
      boundaryIds: [block.blockId],
      coverage: block.coverage,
      failOpenReason: 'source_hash_mismatch',
      validationReasonCounts: validation.reasonCounts,
    });
    assert.equal(patch.compactionDecisions?.[0]?.decision, 'failedOpen');
    assert.equal(patch.compactionDecisions?.[0]?.stage, 'activeStep');
    assert.equal(patch.compactionDecisions?.[0]?.sourceKind, 'providerMessages');
    assert.equal(patch.compactionDecisions?.[0]?.boundaryKind, 'activeFullCompact');
  });

  test('validation fails open without throwing for malformed blocks', () => {
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages: fixtureMessages(),
      runtimeEvents: fixtureRuntimeEvents(),
    });
    const block = buildActiveFullCompactBlockFromSummary({
      sessionId: 'session-1',
      turnId: 'turn-1',
      entries: index.entries,
      summary: fixtureSummary(index.entries.map((entry) => entry.sourceId)),
      now: 100,
    });
    const malformedBlocks: Array<{ name: string; value: unknown; extraReason?: ActiveFullCompactFailOpenReason }> = [
      { name: 'missing coverage', value: { ...block, coverage: undefined } },
      { name: 'missing summary', value: { ...block, summary: undefined }, extraReason: 'summary_missing' },
      {
        name: 'invalid coverage arrays',
        value: { ...block, coverage: { ...block.coverage, providerMessageSourceIds: 'provider:0' } },
      },
      { name: 'malformed archive refs', value: { ...block, archiveRefs: [{ kind: 'toolResult' }] } },
    ];

    for (const { name, value, extraReason } of malformedBlocks) {
      let validation: ActiveFullCompactValidationResult | undefined;
      assert.doesNotThrow(() => {
        validation = validateActiveFullCompactBlockForSourceIndex(value, index);
      }, name);
      assert.equal(validation?.valid, false, name);
      assert.ok(validation?.reasons.includes('invalid_schema_version'), name);
      if (extraReason) assert.ok(validation?.reasons.includes(extraReason), name);
    }
  });

  test('span selection fails open on tool pair split', () => {
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages: fixtureMessages(),
      runtimeEvents: fixtureRuntimeEvents(),
      stepNumber: 3,
      charsPerToken: 1,
    });

    const selection = selectActiveFullCompactCoveredSpan(index, {
      enabled: true,
      minStepNumber: 1,
      minRecentMessages: 1,
      maxActiveEstimatedTokens: 1,
      highWaterRatio: 0.1,
    });

    assert.equal(selection.decision, 'failedOpen');
    assert.equal(selection.reason, 'tool_pair_split');
  });

  test('helper calls leave provider request shape unchanged', () => {
    const messages = fixtureMessages();
    const before = JSON.stringify(messages);
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
      runtimeEvents: fixtureRuntimeEvents(),
    });
    const block = buildActiveFullCompactBlockFromSummary({
      sessionId: 'session-1',
      turnId: 'turn-1',
      entries: index.entries,
      summary: fixtureSummary(index.entries.map((entry) => entry.sourceId)),
      now: 100,
    });
    validateActiveFullCompactBlockForSourceIndex(block, index);
    activeFullCompactBlockToCompactionBoundary(block);

    assert.equal(JSON.stringify(messages), before);
  });

  test('active archive refs and diagnostics coexist with active prune fields', () => {
    const placeholder = activePlaceholder();
    const messages: ModelMessage[] = [{
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-archived',
        toolName: 'Bash',
        result: placeholder,
      }],
    } as unknown as ModelMessage];
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
    });
    const block = buildActiveFullCompactBlockFromSummary({
      sessionId: 'session-1',
      turnId: 'turn-1',
      entries: index.entries,
      summary: fixtureSummary(index.entries.map((entry) => entry.sourceId)),
      now: 100,
    });

    assert.equal(block.archiveRefs?.[0]?.kind, 'toolResult');
    const patch = activeFullCompactDecisionDiagnosticPatch({
      decision: 'replaced',
      boundaryIds: [block.blockId],
      coverage: block.coverage,
      estimatedTokensBefore: 500,
      estimatedTokensAfter: 100,
    });
    assert.equal(patch.compactionDecisions?.[0]?.estimatedTokensSaved, 400);
  });

  test('deterministic summary is bounded and metadata-first', () => {
    const messages = textMessages([
      'RAW_SELECTED_PAYLOAD_'.repeat(100),
      'assistant progress',
      'recent anchor',
    ]);
    const index = buildActiveFullCompactSourceIndex({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
      stepNumber: 2,
      charsPerToken: 1,
    });
    const selection = selectActiveFullCompactCoveredSpan(index, {
      enabled: true,
      minStepNumber: 1,
      minRecentMessages: 1,
      maxActiveEstimatedTokens: 1,
      highWaterRatio: 0.1,
      maxSummaryEstimatedTokens: 60,
    });
    assert.equal(selection.decision, 'selected');
    if (selection.decision !== 'selected') assert.fail('expected selected');

    const summary = buildDeterministicActiveFullCompactSummary({
      selection,
      messages,
      maxSummaryEstimatedTokens: 60,
      charsPerToken: 1,
    });

    assert.equal(summary.schemaVersion, 1);
    assert.ok(summary.text.length <= 60);
    assert.equal(summary.text.includes('RAW_SELECTED_PAYLOAD'), false);
  });

  test('rewrite helper replaces a safe completed span with one compact block', () => {
    const messages = textMessages([
      'old raw payload alpha '.repeat(30),
      'old assistant payload beta '.repeat(30),
      'recent user anchor',
    ]);

    const rewritten = rewriteActiveFullCompactInMessages({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
      policy: {
        enabled: true,
        minStepNumber: 1,
        minRecentMessages: 1,
        maxActiveEstimatedTokens: 1,
        highWaterRatio: 0.1,
        maxSummaryEstimatedTokens: 512,
      },
      stepNumber: 2,
      now: 100,
      charsPerToken: 1,
    });

    assert.equal(rewritten.decision, 'replaced');
    assert.equal(rewritten.messages.length, 2);
    assert.equal(rewritten.messages[1], messages[2]);
    const rendered = (rewritten.messages[0] as { content?: unknown }).content;
    assert.equal(typeof rendered, 'string');
    assert.match(rendered as string, /maka_active_full_compact_block/);
    assert.equal((rendered as string).includes('old raw payload alpha'), false);
    assert.equal(rewritten.diagnosticPatch.compactionDecisions?.[0]?.decision, 'replaced');
  });

  test('rewrite helper dry run validates without mutating messages', () => {
    const messages = textMessages([
      'old raw payload alpha '.repeat(30),
      'old assistant payload beta '.repeat(30),
      'recent user anchor',
    ]);

    const rewritten = rewriteActiveFullCompactInMessages({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
      policy: {
        enabled: true,
        minStepNumber: 1,
        minRecentMessages: 1,
        maxActiveEstimatedTokens: 1,
        highWaterRatio: 0.1,
      },
      stepNumber: 2,
      now: 100,
      charsPerToken: 1,
      requestShapeHashForMessages: (candidate) => `shape:${JSON.stringify(candidate).length}`,
      dryRun: true,
      dryRunReason: 'validate_only',
    });

    assert.equal(rewritten.decision, 'unchanged');
    assert.equal(rewritten.messages.length, messages.length);
    assert.equal(rewritten.messages[0], messages[0]);
    assert.ok(rewritten.block);
    assert.equal(rewritten.diagnosticPatch.compactionDecisions?.[0]?.decision, 'unchanged');
    assert.equal(rewritten.diagnosticPatch.compactionDecisions?.[0]?.reason, 'validate_only');
    assert.equal(
      rewritten.diagnosticPatch.highWaterRequestShapeHashBefore,
      rewritten.diagnosticPatch.highWaterRequestShapeHashAfter,
    );
  });

  test('rewrite helper records unchanged and failed-open diagnostics', () => {
    const messages = textMessages(['old payload', 'recent anchor']);
    const unchanged = rewriteActiveFullCompactInMessages({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
      policy: { enabled: false },
      stepNumber: 2,
    });
    assert.equal(unchanged.decision, 'unchanged');
    assert.equal(unchanged.messages.length, messages.length);
    assert.equal(unchanged.diagnosticPatch.compactionDecisions?.[0]?.decision, 'unchanged');

    const failed = rewriteActiveFullCompactInMessages({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
      policy: {
        enabled: true,
        minStepNumber: 1,
        minRecentMessages: 1,
        maxActiveEstimatedTokens: 1,
        highWaterRatio: 0.1,
        archiveRequired: true,
      },
      stepNumber: 2,
    });
    assert.equal(failed.decision, 'failedOpen');
    assert.equal(failed.messages.length, messages.length);
    assert.equal(failed.diagnosticPatch.compactionDecisions?.[0]?.decision, 'failedOpen');
    assert.equal(failed.diagnosticPatch.compactionDecisions?.[0]?.failOpenReason, 'provider_message_only_when_runtime_required');
  });

  test('rewrite helper preserves active prune archive refs in the compact block', () => {
    const placeholder = activePlaceholder();
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: 'call-archived',
          toolName: 'Bash',
          input: { command: 'npm test' },
        }],
      } as unknown as ModelMessage,
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-archived',
          toolName: 'Bash',
          result: placeholder,
        }],
      } as unknown as ModelMessage,
      { role: 'user', content: 'recent anchor' },
    ];

    const rewritten = rewriteActiveFullCompactInMessages({
      sessionId: 'session-1',
      turnId: 'turn-1',
      messages,
      policy: {
        enabled: true,
        minStepNumber: 1,
        minRecentMessages: 1,
        maxActiveEstimatedTokens: 1,
        highWaterRatio: 0.1,
      },
      stepNumber: 2,
      charsPerToken: 1,
    });

    assert.equal(rewritten.decision, 'replaced');
    assert.equal(rewritten.block?.archiveRefs?.[0]?.artifactId, 'artifact-call-archived');
    assert.match(String((rewritten.messages[0] as { content?: unknown }).content), /artifact-call-archived/);
  });
});

function textMessages(values: string[]): ModelMessage[] {
  return values.map((value, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: value,
  } as ModelMessage));
}

function fixtureMessages(): ModelMessage[] {
  return [
    { role: 'user', content: 'hello world' },
    {
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'Read',
        input: { path: 'README.md' },
      }],
    } as ModelMessage,
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'Read',
        output: { type: 'json', value: { ok: true, body: 'short result' } },
      }],
    } as ModelMessage,
  ];
}

function fixtureRuntimeEvents(): RuntimeEvent[] {
  return [
    runtimeEvent('event-user', 'user', 'user', { kind: 'text', text: 'hello world' }),
    runtimeEvent('event-call', 'model', 'agent', {
      kind: 'function_call',
      id: 'call-1',
      name: 'Read',
      args: { path: 'README.md' },
    }),
    runtimeEvent('event-response', 'tool', 'tool', {
      kind: 'function_response',
      id: 'call-1',
      name: 'Read',
      result: { ok: true, body: 'short result' },
    }),
  ];
}

function runtimeEvent(
  id: string,
  role: RuntimeEvent['role'],
  author: RuntimeEvent['author'],
  content: NonNullable<RuntimeEvent['content']>,
): RuntimeEvent {
  return {
    id,
    invocationId: 'inv-1',
    runId: 'run-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    ts: 10,
    partial: false,
    role,
    author,
    content,
    refs: content.kind === 'function_call' || content.kind === 'function_response'
      ? { toolCallId: content.id }
      : undefined,
  };
}

function activePlaceholder(): ActiveArchivedToolResultPlaceholder {
  return {
    kind: ACTIVE_ARCHIVED_TOOL_RESULT_PLACEHOLDER_KIND,
    rewriteVersion: ARCHIVED_TOOL_RESULT_REWRITE_VERSION,
    artifactId: 'artifact-call-archived',
    turnId: 'turn-1',
    toolCallId: 'call-archived',
    toolName: 'Bash',
    bodySha256: 'a'.repeat(64),
    originalEstimatedTokens: 123,
    originalBytes: 456,
    reason: 'active_current_turn_tool_result_pruned_before_next_step',
  };
}

function fixtureSummary(sourceIds: string[]): ActiveFullCompactSummary {
  return {
    schemaVersion: 1,
    text: 'Terminal task progressed through file inspection and a short verifier run.',
    processState: ['no long-running process observed'],
    vmState: ['guest state unchanged'],
    artifactPaths: ['README.md'],
    commandsTried: [{ command: 'npm test', outcome: 'failed before archived raw output was inspected', sourceIds }],
    latestVerifierFailure: 'unit verifier still red',
    constraints: ['do not alter provider request shape in PR1'],
    failedHypotheses: ['raw output alone is enough context'],
    currentHypothesis: 'source-bearing summary can cover the active span',
    nextActions: ['wire provider-visible replacement in PR2'],
    archiveRefs: ['artifact-call-archived'],
  };
}
