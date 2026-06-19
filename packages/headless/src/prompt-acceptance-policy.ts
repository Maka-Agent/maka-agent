import {
  appendFixedPromptWalEvent,
  FIXED_PROMPT_WAL_SCHEMA_VERSION,
  type FixedPromptWalEvent,
  type FixedPromptTaskWalEvent,
  type PromptCandidateDecisionEvent,
} from './fixed-prompt-controller.js';

export type PromptAcceptanceDecision = 'keep' | 'discard';

export type PromptAcceptanceReason =
  | 'held_in_improved'
  | 'held_in_within_noise'
  | 'held_in_regressed'
  | 'coverage_regressed'
  | 'held_out_regressed';

export interface PromptAcceptancePartitionSummary {
  taskCount: number;
  observed: number;
  eligible: number;
  scored: number;
  passed: number;
  passEligibleRate: number | null;
  coverageRate: number | null;
  unscoredTaskIds: string[];
  missingTaskIds: string[];
}

export interface PromptAcceptanceMetrics {
  original: {
    heldOut: PromptAcceptancePartitionSummary;
  };
  lastKept: {
    heldIn: PromptAcceptancePartitionSummary;
  };
  candidate: {
    heldIn: PromptAcceptancePartitionSummary;
    heldOut: PromptAcceptancePartitionSummary;
  };
}

export interface DecidePromptAcceptanceInput {
  runId: string;
  roundId: string;
  candidateCommitSha: string;
  previousLastKeptCommitSha: string;
  originalCommitSha: string;
  heldInTaskIds: readonly string[];
  heldOutTaskIds: readonly string[];
  passRateNoiseBand: number;
  coverageNoiseBand: number;
  originalEvents: readonly FixedPromptTaskWalEvent[];
  lastKeptEvents: readonly FixedPromptTaskWalEvent[];
  candidateEvents: readonly FixedPromptTaskWalEvent[];
}

export interface PromptAcceptanceResult {
  runId: string;
  roundId: string;
  decision: PromptAcceptanceDecision;
  reason: PromptAcceptanceReason;
  candidateCommitSha: string;
  previousLastKeptCommitSha: string;
  lastKeptCommitSha: string;
  originalCommitSha: string;
  metrics: PromptAcceptanceMetrics;
}

export interface AppendPromptAcceptanceDecisionInput {
  resultsJsonlPath: string;
  id: string;
  ts: number;
  result: PromptAcceptanceResult;
}

export interface PromptAcceptanceState {
  lastKeptCommitSha: string;
  decisions: Array<{
    roundId: string;
    decision: PromptAcceptanceDecision;
    candidateCommitSha: string;
  }>;
}

export function decidePromptAcceptance(input: DecidePromptAcceptanceInput): PromptAcceptanceResult {
  const metrics: PromptAcceptanceMetrics = {
    original: {
      heldOut: summarizePromptAcceptancePartition(input.originalEvents, input.heldOutTaskIds),
    },
    lastKept: {
      heldIn: summarizePromptAcceptancePartition(input.lastKeptEvents, input.heldInTaskIds),
    },
    candidate: {
      heldIn: summarizePromptAcceptancePartition(input.candidateEvents, input.heldInTaskIds),
      heldOut: summarizePromptAcceptancePartition(input.candidateEvents, input.heldOutTaskIds),
    },
  };
  const reason = acceptanceReason(metrics, input.passRateNoiseBand, input.coverageNoiseBand);
  const decision: PromptAcceptanceDecision = reason === 'held_in_improved' ? 'keep' : 'discard';
  return {
    runId: input.runId,
    roundId: input.roundId,
    decision,
    reason,
    candidateCommitSha: input.candidateCommitSha,
    previousLastKeptCommitSha: input.previousLastKeptCommitSha,
    lastKeptCommitSha: decision === 'keep' ? input.candidateCommitSha : input.previousLastKeptCommitSha,
    originalCommitSha: input.originalCommitSha,
    metrics,
  };
}

export async function appendPromptAcceptanceDecision(
  input: AppendPromptAcceptanceDecisionInput,
): Promise<PromptCandidateDecisionEvent> {
  const event = promptCandidateDecisionEvent(input);
  await appendFixedPromptWalEvent(input.resultsJsonlPath, event);
  return event;
}

export function promptAcceptanceStateFromWal(
  events: readonly FixedPromptWalEvent[],
  initialLastKeptCommitSha: string,
): PromptAcceptanceState {
  const decisions: PromptAcceptanceState['decisions'] = [];
  let lastKeptCommitSha = initialLastKeptCommitSha;
  for (const event of events) {
    if (event.type !== 'prompt_candidate_decided') continue;
    lastKeptCommitSha = event.lastKeptCommitSha;
    decisions.push({
      roundId: event.roundId,
      decision: event.decision,
      candidateCommitSha: event.candidateCommitSha,
    });
  }
  return { lastKeptCommitSha, decisions };
}

export function summarizePromptAcceptancePartition(
  events: readonly FixedPromptTaskWalEvent[],
  taskIds: readonly string[],
): PromptAcceptancePartitionSummary {
  const byTask = new Map(events.map((event) => [event.taskId, event]));
  const selected = taskIds.map((taskId) => byTask.get(taskId));
  const observed = selected.filter((event): event is FixedPromptTaskWalEvent => event !== undefined);
  const eligible = observed.filter((event) => event.eligible);
  const scored = observed.filter((event) => event.scored);
  const passed = observed.filter((event) => event.passed);
  return {
    taskCount: taskIds.length,
    observed: observed.length,
    eligible: eligible.length,
    scored: scored.length,
    passed: passed.length,
    passEligibleRate: eligible.length > 0 ? passed.length / eligible.length : null,
    coverageRate: taskIds.length > 0 ? scored.length / taskIds.length : null,
    unscoredTaskIds: taskIds.filter((taskId) => {
      const event = byTask.get(taskId);
      return event !== undefined && !event.scored;
    }),
    missingTaskIds: taskIds.filter((taskId) => !byTask.has(taskId)),
  };
}

function promptCandidateDecisionEvent(
  input: AppendPromptAcceptanceDecisionInput,
): PromptCandidateDecisionEvent {
  return {
    schemaVersion: FIXED_PROMPT_WAL_SCHEMA_VERSION,
    type: 'prompt_candidate_decided',
    id: input.id,
    ts: input.ts,
    runId: input.result.runId,
    roundId: input.result.roundId,
    decision: input.result.decision,
    reason: input.result.reason,
    candidateCommitSha: input.result.candidateCommitSha,
    previousLastKeptCommitSha: input.result.previousLastKeptCommitSha,
    lastKeptCommitSha: input.result.lastKeptCommitSha,
    originalCommitSha: input.result.originalCommitSha,
    metrics: input.result.metrics,
  };
}

function acceptanceReason(
  metrics: PromptAcceptanceMetrics,
  passRateNoiseBand: number,
  coverageNoiseBand: number,
): PromptAcceptanceReason {
  const heldInCandidate = metrics.candidate.heldIn;
  const heldInReference = metrics.lastKept.heldIn;
  const heldOutCandidate = metrics.candidate.heldOut;
  const heldOutReference = metrics.original.heldOut;

  if (regressed(heldInCandidate.coverageRate, heldInReference.coverageRate, coverageNoiseBand)) {
    return 'coverage_regressed';
  }
  if (regressed(heldOutCandidate.coverageRate, heldOutReference.coverageRate, coverageNoiseBand)) {
    return 'coverage_regressed';
  }
  if (regressed(heldOutCandidate.passEligibleRate, heldOutReference.passEligibleRate, passRateNoiseBand)) {
    return 'held_out_regressed';
  }
  if (improved(heldInCandidate.passEligibleRate, heldInReference.passEligibleRate, passRateNoiseBand)) {
    return 'held_in_improved';
  }
  if (regressed(heldInCandidate.passEligibleRate, heldInReference.passEligibleRate, passRateNoiseBand)) {
    return 'held_in_regressed';
  }
  return 'held_in_within_noise';
}

function improved(candidate: number | null, reference: number | null, noiseBand: number): boolean {
  return candidate !== null && reference !== null && candidate > reference + noiseBand;
}

function regressed(candidate: number | null, reference: number | null, noiseBand: number): boolean {
  return candidate === null || (reference !== null && candidate < reference - noiseBand);
}
