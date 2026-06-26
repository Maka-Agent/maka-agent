import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { readFixedPromptWal, type FixedPromptTaskWalEvent, type PromptCandidateRationale } from '../fixed-prompt-controller.js';
import { appendRsiControllerAttribution, buildRsiControllerAttribution, projectRsiPromptAttribution } from '../rsi-controller-attribution.js';
import type { RsiRoundAnalysis } from '../rsi-round-analysis.js';
import type { PromptAcceptanceResult } from '../prompt-acceptance-policy.js';
import { tokenSummary } from './helpers/cell-output-fixtures.js';

describe('RSI controller attribution', () => {
  test('compares candidate rationale predictions to held-in outcomes', () => {
    const rationale: PromptCandidateRationale = {
      failurePattern: 'coverage_regression',
      hypothesis: 'restore coverage for the unstable held-in task',
      targetedFix: 'keep artifact creation requirements explicit',
      predictedFixes: ['task-a', 'task-b'],
      riskTasks: ['task-c'],
    };
    const analysis: RsiRoundAnalysis = {
      heldInTaskSetHash: 'sha256:held-in',
      transitionVsLastKept: [
        { taskId: 'task-a', from: 'fail', to: 'pass' },
        { taskId: 'task-b', from: 'pass', to: 'unscored' },
        { taskId: 'task-c', from: 'pass', to: 'fail' },
        { taskId: 'task-d', from: 'fail', to: 'pass' },
      ],
      transitionVsPreviousCandidate: [],
      coverageRegressionTaskIds: ['task-b'],
      errorClassDistribution: [{ errorClass: 'max_tokens', count: 1 }],
      toolFailureClusters: [],
      signals: [
        { id: 'rsi-sig:coverage', kind: 'coverage_regression', taskIds: ['task-b'] },
      ],
    };

    const attribution = buildRsiControllerAttribution({
      runId: 'run-1',
      roundId: 'round-0',
      candidateCommitSha: 'commit-1',
      candidateRationaleHash: 'sha256:rationale',
      candidateRationale: rationale,
      analysis,
      heldInTaskIds: ['task-a', 'task-b', 'task-c', 'task-d'],
      lastKeptEvents: [
        completed({ taskId: 'task-a', passed: false }),
        completed({ taskId: 'task-b', passed: true }),
        completed({ taskId: 'task-c', passed: true }),
        completed({ taskId: 'task-d', passed: false }),
      ],
      candidateEvents: [
        completed({ taskId: 'task-a', passed: true }),
        completed({ taskId: 'task-b', passed: false, scored: false, errorClass: 'max_tokens' }),
        completed({ taskId: 'task-c', passed: false }),
        completed({ taskId: 'task-d', passed: true }),
        completed({ taskId: 'held-out-secret', passed: false }),
      ],
      decision: acceptanceResult({ reason: 'coverage_regressed', decision: 'discard' }),
    });

    assert.deepEqual(attribution.predictedFixes, [
      { taskId: 'task-a', outcome: 'improved' },
      { taskId: 'task-b', outcome: 'unscored' },
    ]);
    assert.deepEqual(attribution.riskTasks, [
      { taskId: 'task-c', outcome: 'regressed' },
    ]);
    assert.deepEqual(attribution.unexpectedHeldInFlips, [
      { taskId: 'task-d', from: 'fail', to: 'pass' },
    ]);
    assert.equal(attribution.rootCauseSignalMatch, 'matched');
    assert.equal(JSON.stringify(attribution).includes('held-out-secret'), false);
  });

  test('persists controller attribution as a WAL event', async () => {
    await withDir(async (dir) => {
      const resultsJsonlPath = join(dir, 'results.jsonl');
      const attribution = buildRsiControllerAttribution({
        runId: 'run-1',
        roundId: 'round-0',
        candidateCommitSha: 'commit-1',
        candidateRationaleHash: 'sha256:rationale',
        candidateRationale: {
          failurePattern: 'other',
          hypothesis: 'unknown held-in behavior changed',
          targetedFix: 'make prompt wording simpler',
          predictedFixes: [],
          riskTasks: [],
        },
        analysis: {
          heldInTaskSetHash: 'sha256:held-in',
          transitionVsLastKept: [],
          transitionVsPreviousCandidate: [],
          coverageRegressionTaskIds: [],
          errorClassDistribution: [],
          toolFailureClusters: [],
          signals: [],
        },
        heldInTaskIds: ['task-a'],
        lastKeptEvents: [completed({ taskId: 'task-a', passed: true })],
        candidateEvents: [completed({ taskId: 'task-a', passed: true })],
        decision: acceptanceResult({ decision: 'keep', reason: 'held_in_improved' }),
      });

      const event = await appendRsiControllerAttribution({
        resultsJsonlPath,
        id: 'attr-event-1',
        ts: 2,
        attribution,
      });
      const events = await readFixedPromptWal(resultsJsonlPath);

      assert.equal(event.type, 'rsi_controller_attribution');
      assert.deepEqual(events, [event]);
      assert.equal(events[0]?.type, 'rsi_controller_attribution');
      if (events[0]?.type === 'rsi_controller_attribution') {
        assert.equal(events[0].candidateCommitSha, 'commit-1');
        assert.equal(events[0].heldInTaskSetHash, 'sha256:held-in');
        assert.equal(events[0].rootCauseSignalMatch, 'unknown');
      }
    });
  });

  test('projects held-out safety decisions as generic prompt feedback', () => {
    const attribution = buildRsiControllerAttribution({
      runId: 'run-1',
      roundId: 'round-0',
      candidateCommitSha: 'commit-1',
      candidateRationaleHash: 'sha256:rationale',
      candidateRationale: {
        failurePattern: 'other',
        hypothesis: 'unknown held-in behavior changed',
        targetedFix: 'make prompt wording simpler',
        predictedFixes: [],
        riskTasks: [],
      },
      analysis: {
        heldInTaskSetHash: 'sha256:held-in',
        transitionVsLastKept: [],
        transitionVsPreviousCandidate: [],
        coverageRegressionTaskIds: [],
        errorClassDistribution: [],
        toolFailureClusters: [],
        signals: [],
      },
      heldInTaskIds: ['task-a'],
      lastKeptEvents: [completed({ taskId: 'task-a', passed: true })],
      candidateEvents: [completed({ taskId: 'task-a', passed: true })],
      decision: acceptanceResult({ decision: 'discard', reason: 'held_out_regressed' }),
    });

    const promptAttribution = projectRsiPromptAttribution(attribution);

    assert.equal(promptAttribution.decisionReason, 'discarded_by_controller_safety_gate');
    assert.equal(JSON.stringify(promptAttribution).includes('held_out_regressed'), false);
  });
});

function completed(input: {
  taskId: string;
  passed: boolean;
  scored?: boolean;
  errorClass?: string;
}): FixedPromptTaskWalEvent {
  return {
    schemaVersion: 1,
    type: 'task_completed',
    id: `${input.taskId}-event`,
    ts: 1,
    runId: 'run-1',
    roundId: 'round-1',
    taskId: input.taskId,
    status: input.passed ? 'completed' : 'failed',
    passed: input.passed,
    scored: input.scored ?? true,
    eligible: true,
    ...(input.errorClass ? { errorClass: input.errorClass } : {}),
    promptHash: 'sha256:prompt',
    tokenSummary: tokenSummary({ input: 1, output: 1, reasoning: 0, total: 2, costUsd: 0.01 }),
    steps: 1,
    durationMs: 10,
    runtimeEventsPath: '/tmp/runtime-events.jsonl',
    harbor: { reward: input.passed ? 1 : 0 },
  };
}

function acceptanceResult(input: {
  decision: 'keep' | 'discard';
  reason: PromptAcceptanceResult['reason'];
}): PromptAcceptanceResult {
  return {
    runId: 'run-1',
    roundId: 'round-0',
    decision: input.decision,
    reason: input.reason,
    candidateCommitSha: 'commit-1',
    previousLastKeptCommitSha: 'commit-0',
    lastKeptCommitSha: input.decision === 'keep' ? 'commit-1' : 'commit-0',
    previousHeldInReferencePassEligibleRate: 0.5,
    heldInReferencePassEligibleRate: 0.5,
    originalCommitSha: 'commit-0',
    originalHeldOutPassEligibleRate: 0.5,
    heldInPassRateNoiseBand: 0.1,
    heldOutPassRateNoiseBand: 0.1,
    rewardHackScan: { decision: 'clean' },
    metrics: {
      original: { heldOut: partitionSummary() },
      lastKept: { heldIn: partitionSummary() },
      candidate: { heldIn: partitionSummary(), heldOut: partitionSummary() },
    },
  };
}

function partitionSummary(): PromptAcceptanceResult['metrics']['candidate']['heldIn'] {
  return {
    taskCount: 0,
    observed: 0,
    eligible: 0,
    scored: 0,
    passed: 0,
    passEligibleRate: null,
    coverageRate: null,
    unscoredTaskIds: [],
    infraFailedTaskIds: [],
    plumbingFailedTaskIds: [],
    missingTaskIds: [],
  };
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'maka-rsi-attribution-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
