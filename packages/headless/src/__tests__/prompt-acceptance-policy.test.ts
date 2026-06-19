import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  appendPromptAcceptanceDecision,
  decidePromptAcceptance,
  promptAcceptanceStateFromWal,
  summarizePromptAcceptancePartition,
} from '../prompt-acceptance-policy.js';
import type {
  FixedPromptTaskCompletedEvent,
  FixedPromptTaskWalEvent,
} from '../fixed-prompt-controller.js';
import { readFixedPromptWal } from '../fixed-prompt-controller.js';

describe('prompt acceptance policy', () => {
  test('keeps candidates that improve held-in beyond noise without falling below the held-out original floor', () => {
    const heldInTaskIds = ['in-a', 'in-b', 'in-c', 'in-d'];
    const heldOutTaskIds = ['out-a', 'out-b'];

    const decision = decidePromptAcceptance({
      runId: 'run-1',
      roundId: 'round-2',
      candidateCommitSha: 'candidate-2',
      previousLastKeptCommitSha: 'kept-1',
      originalCommitSha: 'original-0',
      heldInTaskIds,
      heldOutTaskIds,
      passRateNoiseBand: 0.05,
      coverageNoiseBand: 0,
      originalEvents: [
        completed('out-a', true),
        completed('out-b', true),
      ],
      lastKeptEvents: [
        completed('in-a', true),
        completed('in-b', false),
        completed('in-c', false),
        completed('in-d', false),
      ],
      candidateEvents: [
        completed('in-a', true),
        completed('in-b', true),
        completed('in-c', true),
        completed('in-d', false),
        completed('out-a', true),
        completed('out-b', true),
      ],
    });

    assert.equal(decision.decision, 'keep');
    assert.equal(decision.reason, 'held_in_improved');
    assert.equal(decision.lastKeptCommitSha, 'candidate-2');
    assert.equal(decision.metrics.lastKept.heldIn.passEligibleRate, 0.25);
    assert.equal(decision.metrics.candidate.heldIn.passEligibleRate, 0.75);
    assert.equal(decision.metrics.original.heldOut.passEligibleRate, 1);
    assert.equal(decision.metrics.candidate.heldOut.passEligibleRate, 1);
  });

  test('summarizes pass over eligible separately from coverage', () => {
    const summary = summarizePromptAcceptancePartition([
      completed('task-a', true),
      completed('task-b', false),
      completed('task-c', true, { scored: false }),
      infraFailed('task-d'),
    ], ['task-a', 'task-b', 'task-c', 'task-d']);

    assert.deepEqual(summary, {
      taskCount: 4,
      observed: 4,
      eligible: 3,
      scored: 2,
      passed: 2,
      passEligibleRate: 2 / 3,
      coverageRate: 0.5,
      unscoredTaskIds: ['task-c', 'task-d'],
      missingTaskIds: [],
    });
  });

  test('discards flat held-in changes inside the noise band', () => {
    const decision = decidePromptAcceptance({
      ...baseDecisionInput(),
      passRateNoiseBand: 0.1,
      lastKeptEvents: [
        completed('in-a', true),
        completed('in-b', false),
      ],
      candidateEvents: [
        completed('in-a', true),
        completed('in-b', false),
        completed('out-a', true),
      ],
    });

    assert.equal(decision.decision, 'discard');
    assert.equal(decision.reason, 'held_in_within_noise');
    assert.equal(decision.lastKeptCommitSha, 'kept-1');
  });

  test('discards held-in regressions', () => {
    const decision = decidePromptAcceptance({
      ...baseDecisionInput(),
      passRateNoiseBand: 0.05,
      lastKeptEvents: [
        completed('in-a', true),
        completed('in-b', true),
      ],
      candidateEvents: [
        completed('in-a', true),
        completed('in-b', false),
        completed('out-a', true),
      ],
    });

    assert.equal(decision.decision, 'discard');
    assert.equal(decision.reason, 'held_in_regressed');
  });

  test('discards candidate coverage degradation, including infra failures', () => {
    const decision = decidePromptAcceptance({
      ...baseDecisionInput(),
      coverageNoiseBand: 0,
      lastKeptEvents: [
        completed('in-a', true),
        completed('in-b', false),
      ],
      candidateEvents: [
        completed('in-a', true),
        infraFailed('in-b'),
        completed('out-a', true),
      ],
    });

    assert.equal(decision.decision, 'discard');
    assert.equal(decision.reason, 'coverage_regressed');
    assert.deepEqual(decision.metrics.candidate.heldIn.unscoredTaskIds, ['in-b']);
  });

  test('discards candidates that fall below the held-out original floor', () => {
    const decision = decidePromptAcceptance({
      ...baseDecisionInput(),
      heldOutTaskIds: ['out-a', 'out-b'],
      originalEvents: [
        completed('out-a', true),
        completed('out-b', true),
      ],
      lastKeptEvents: [
        completed('in-a', true),
        completed('in-b', false),
      ],
      candidateEvents: [
        completed('in-a', true),
        completed('in-b', true),
        completed('out-a', true),
        completed('out-b', false),
      ],
    });

    assert.equal(decision.decision, 'discard');
    assert.equal(decision.reason, 'held_out_regressed');
  });

  test('records KEEP and DISCARD decisions in the WAL and resumes last kept commit', async () => {
    await withDir(async (dir) => {
      const resultsJsonlPath = join(dir, 'results.jsonl');
      const keep = decidePromptAcceptance(baseDecisionInput());
      await appendPromptAcceptanceDecision({
        resultsJsonlPath,
        id: 'decision-1',
        ts: 100,
        result: keep,
      });

      const discard = decidePromptAcceptance({
        ...baseDecisionInput(),
        roundId: 'round-3',
        candidateCommitSha: 'candidate-3',
        previousLastKeptCommitSha: keep.lastKeptCommitSha,
        candidateEvents: [
          completed('in-a', true),
          completed('in-b', false),
          completed('out-a', true),
        ],
      });
      await appendPromptAcceptanceDecision({
        resultsJsonlPath,
        id: 'decision-2',
        ts: 101,
        result: discard,
      });

      const events = await readFixedPromptWal(resultsJsonlPath);
      assert.equal(events.length, 2);
      assert.deepEqual(events.map((event) => event.type), [
        'prompt_candidate_decided',
        'prompt_candidate_decided',
      ]);
      assert.deepEqual(promptAcceptanceStateFromWal(events, 'original-0'), {
        lastKeptCommitSha: 'candidate-2',
        decisions: [
          { roundId: 'round-2', decision: 'keep', candidateCommitSha: 'candidate-2' },
          { roundId: 'round-3', decision: 'discard', candidateCommitSha: 'candidate-3' },
        ],
      });
    });
  });
});

function baseDecisionInput() {
  return {
    runId: 'run-1',
    roundId: 'round-2',
    candidateCommitSha: 'candidate-2',
    previousLastKeptCommitSha: 'kept-1',
    originalCommitSha: 'original-0',
    heldInTaskIds: ['in-a', 'in-b'],
    heldOutTaskIds: ['out-a'],
    passRateNoiseBand: 0.05,
    coverageNoiseBand: 0,
    originalEvents: [completed('out-a', true)],
    lastKeptEvents: [completed('in-a', true), completed('in-b', false)],
    candidateEvents: [completed('in-a', true), completed('in-b', true), completed('out-a', true)],
  };
}

function completed(
  taskId: string,
  passed: boolean,
  overrides: Partial<FixedPromptTaskCompletedEvent> = {},
): FixedPromptTaskWalEvent {
  return {
    schemaVersion: 1,
    type: 'task_completed',
    id: `event-${taskId}`,
    ts: 1,
    runId: 'run-1',
    roundId: 'round-1',
    taskId,
    status: 'completed',
    passed,
    scored: true,
    eligible: true,
    tokenSummary: { input: 1, output: 1, reasoning: 0, total: 2, costUsd: 0.01 },
    steps: 1,
    durationMs: 10,
    runtimeEventsPath: `/logs/${taskId}.jsonl`,
    harbor: { reward: passed ? 1 : 0 },
    ...overrides,
  };
}

function infraFailed(taskId: string): FixedPromptTaskWalEvent {
  return {
    schemaVersion: 1,
    type: 'task_infra_failed',
    id: `event-${taskId}`,
    ts: 1,
    runId: 'run-1',
    roundId: 'round-1',
    taskId,
    status: 'infra_failed',
    passed: false,
    scored: false,
    eligible: false,
    errorClass: 'infra_error',
    error: 'container crashed',
  };
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'maka-prompt-acceptance-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
