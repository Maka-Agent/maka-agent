import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  FixedPromptTaskWalEvent,
  FixedPromptWalEvent,
  PromptCandidateCommittedEvent,
  PromptCandidateDecisionEvent,
  RsiControllerAttributionEvent,
} from './fixed-prompt-controller.js';

const execFileAsync = promisify(execFile);

export interface PromptOptimizationReplayState {
  seedCommitSha: string;
  lastKeptCommitSha: string;
  expectedPromptRepoHead: string;
  candidateByRoundId: ReadonlyMap<string, PromptCandidateCommittedEvent>;
  decisionByRoundId: ReadonlyMap<string, PromptCandidateDecisionEvent>;
  attributionByRoundId: ReadonlyMap<string, RsiControllerAttributionEvent>;
}

export async function derivePromptOptimizationReplayState(input: {
  events: readonly FixedPromptWalEvent[];
  promptRepoDir: string;
  runId?: string;
  resumeFingerprint?: string;
  strictRoundState?: boolean;
}): Promise<PromptOptimizationReplayState> {
  const seedCommitSha = await gitOutput(input.promptRepoDir, 'rev-list', '--max-parents=0', 'HEAD');
  let lastKeptCommitSha = seedCommitSha;
  let expectedPromptRepoHead = seedCommitSha;
  const candidateByRoundId = new Map<string, PromptCandidateCommittedEvent>();
  const decisionByRoundId = new Map<string, PromptCandidateDecisionEvent>();
  const attributionByRoundId = new Map<string, RsiControllerAttributionEvent>();

  for (const event of input.events) {
    if (!matchesRun(event, input.runId)) continue;
    if (
      input.resumeFingerprint !== undefined
      && isTaskEvent(event)
      && event.resumeFingerprint !== input.resumeFingerprint
    ) {
      throw new Error(`RSI WAL replay identity mismatch for ${event.roundId}/${event.taskId}`);
    }
    if (isTaskEvent(event) && event.roundId.startsWith('round-')) {
      const candidate = candidateByRoundId.get(event.roundId);
      if (!candidate && input.strictRoundState) {
        throw new Error(`RSI WAL replay found task evidence before candidate commit for ${event.roundId}`);
      }
      const eventPromptHash = promptHashForReplayIdentity(event);
      if (candidate && eventPromptHash !== undefined && eventPromptHash !== candidate.promptHash) {
        throw new Error(`RSI WAL replay prompt hash mismatch for ${event.roundId}/${event.taskId}`);
      }
    }
    if (event.type === 'prompt_candidate_committed') {
      if (candidateByRoundId.has(event.roundId)) {
        throw new Error(`RSI WAL replay found duplicate candidate commit for ${event.roundId}`);
      }
      candidateByRoundId.set(event.roundId, event);
      expectedPromptRepoHead = event.commitSha;
      continue;
    }
    if (event.type === 'prompt_candidate_decided') {
      if (decisionByRoundId.has(event.roundId)) {
        throw new Error(`RSI WAL replay found duplicate prompt decision for ${event.roundId}`);
      }
      const candidate = candidateByRoundId.get(event.roundId);
      if (!candidate && input.strictRoundState) {
        throw new Error(`RSI WAL replay found decision without candidate commit for ${event.roundId}`);
      }
      if (candidate && candidate.commitSha !== event.candidateCommitSha) {
        throw new Error(`RSI WAL replay found decision candidate mismatch for ${event.roundId}`);
      }
      if (input.strictRoundState && event.previousLastKeptCommitSha !== lastKeptCommitSha) {
        throw new Error(`RSI WAL replay found stale previous last-kept for ${event.roundId}`);
      }
      const expectedLastKept = event.decision === 'keep' ? event.candidateCommitSha : event.previousLastKeptCommitSha;
      if (input.strictRoundState && event.lastKeptCommitSha !== expectedLastKept) {
        throw new Error(`RSI WAL replay found invalid last-kept for ${event.roundId}`);
      }
      if (input.strictRoundState && event.originalCommitSha !== seedCommitSha) {
        throw new Error(`RSI WAL replay found original commit mismatch for ${event.roundId}`);
      }
      decisionByRoundId.set(event.roundId, event);
      lastKeptCommitSha = event.lastKeptCommitSha;
      expectedPromptRepoHead = event.lastKeptCommitSha;
      continue;
    }
    if (event.type === 'rsi_controller_attribution') {
      if (attributionByRoundId.has(event.roundId)) {
        throw new Error(`RSI WAL replay found duplicate RSI attribution for ${event.roundId}`);
      }
      const candidate = candidateByRoundId.get(event.roundId);
      if (!candidate || candidate.commitSha !== event.candidateCommitSha) {
        throw new Error(`RSI WAL replay found attribution candidate mismatch for ${event.roundId}`);
      }
      if (candidate.heldInTaskSetHash !== event.heldInTaskSetHash) {
        throw new Error(`RSI WAL replay found attribution task-set mismatch for ${event.roundId}`);
      }
      attributionByRoundId.set(event.roundId, event);
    }
  }

  return {
    seedCommitSha,
    lastKeptCommitSha,
    expectedPromptRepoHead,
    candidateByRoundId,
    decisionByRoundId,
    attributionByRoundId,
  };
}

function matchesRun(event: FixedPromptWalEvent, runId: string | undefined): boolean {
  return runId === undefined || event.runId === runId;
}

function isTaskEvent(event: FixedPromptWalEvent): event is FixedPromptTaskWalEvent {
  return event.type === 'task_completed'
    || event.type === 'task_infra_failed'
    || event.type === 'task_budget_exhausted'
    || event.type === 'task_plumbing_failed';
}

function promptHashForReplayIdentity(event: FixedPromptTaskWalEvent): string | undefined {
  if (event.type === 'task_completed') return event.promptHash;
  if (event.type === 'task_plumbing_failed') return event.promptHash ?? event.expectedPromptHash;
  if (event.type === 'task_budget_exhausted') return event.expectedPromptHash;
  return undefined;
}

async function gitOutput(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.trim();
}
