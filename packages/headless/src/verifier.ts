import { isAbsolute, join } from 'node:path';
import type { Task, TaskVerification, VerifierSpec } from './contracts.js';
import { runVerification, type EvaluationResult } from './evaluator.js';
import type { VerifierResult } from './task-contracts.js';

export function normalizeVerifier(task: Task): VerifierSpec {
  const verifier = task.verifier ?? verifierFromLegacy(task.verification);
  if (!verifier) {
    throw new Error(`task "${task.id}": verifier or verification is required`);
  }

  switch (verifier.kind) {
    case 'command':
      if (typeof verifier.command !== 'string' || verifier.command.trim().length === 0) {
        throw new Error(`task "${task.id}": command verifier requires a non-empty command`);
      }
      validateProtectedPaths(task.id, verifier.protectedPaths);
      return {
        ...verifier,
        protectedPaths: [...verifier.protectedPaths],
        ...(verifier.env ? { env: { ...verifier.env } } : {}),
      };
    case 'terminal_bench':
      if (verifier.adapter !== 'terminal-bench' || !verifier.instanceId) {
        throw new Error(`task "${task.id}": terminal_bench verifier requires adapter and instanceId`);
      }
      validateProtectedPaths(task.id, verifier.protectedPaths ?? []);
      return { ...verifier, protectedPaths: verifier.protectedPaths ? [...verifier.protectedPaths] : undefined };
    case 'swe_bench':
      if (verifier.adapter !== 'swe-bench' || !verifier.instanceId) {
        throw new Error(`task "${task.id}": swe_bench verifier requires adapter and instanceId`);
      }
      validateProtectedPaths(task.id, verifier.protectedPaths ?? []);
      return { ...verifier, protectedPaths: verifier.protectedPaths ? [...verifier.protectedPaths] : undefined };
  }
}

export function verifierProtectedPaths(verifier: VerifierSpec): string[] {
  return verifier.protectedPaths ? [...verifier.protectedPaths] : [];
}

export async function runVerifier(input: {
  verifier: VerifierSpec;
  taskRunId: string;
  attemptId?: string;
  ts: number;
  id: string;
  workspaceDir: string;
  submittedSnapshotId?: string;
  scoringWorkspaceId?: string;
}): Promise<VerifierResult> {
  if (input.verifier.kind !== 'command') {
    return {
      id: input.id,
      taskRunId: input.taskRunId,
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      ts: input.ts,
      kind: input.verifier.kind,
      passed: false,
      exitCode: null,
      error: `${input.verifier.kind} verifier adapter is not implemented`,
      errorClass: 'unsupported_adapter',
      submittedSnapshotId: input.submittedSnapshotId,
      scoringWorkspaceId: input.scoringWorkspaceId,
    };
  }

  const startedAt = Date.now();
  const cwd = input.verifier.cwd ? join(input.workspaceDir, input.verifier.cwd) : input.workspaceDir;
  const evaluation = await runVerification(
    input.verifier.command,
    cwd,
    input.verifier.timeoutMs,
    input.verifier.env,
  );
  return verifierResultFromEvaluation({
    evaluation,
    command: input.verifier.command,
    id: input.id,
    taskRunId: input.taskRunId,
    attemptId: input.attemptId,
    ts: input.ts,
    durationMs: Date.now() - startedAt,
    submittedSnapshotId: input.submittedSnapshotId,
    scoringWorkspaceId: input.scoringWorkspaceId,
  });
}

export function verifierResultFromEvaluation(input: {
  evaluation: EvaluationResult;
  command?: string;
  id: string;
  taskRunId: string;
  attemptId?: string;
  ts: number;
  durationMs?: number;
  submittedSnapshotId?: string;
  scoringWorkspaceId?: string;
}): VerifierResult {
  const errorClass = input.evaluation.timedOut || input.evaluation.exitCode === null
    ? 'verification_error'
    : input.evaluation.passed
      ? undefined
      : 'verification_failed';
  return {
    id: input.id,
    taskRunId: input.taskRunId,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ts: input.ts,
    kind: 'command',
    passed: input.evaluation.passed,
    exitCode: input.evaluation.exitCode,
    command: input.command,
    durationMs: input.durationMs,
    stdout: input.evaluation.stdout,
    stderr: input.evaluation.stderr,
    timedOut: input.evaluation.timedOut,
    ...(errorClass ? { errorClass } : {}),
    ...(input.evaluation.timedOut ? { error: 'verification timed out' } : {}),
    submittedSnapshotId: input.submittedSnapshotId,
    scoringWorkspaceId: input.scoringWorkspaceId,
  };
}

function verifierFromLegacy(verification: TaskVerification | undefined): VerifierSpec | undefined {
  if (!verification) return undefined;
  return {
    kind: 'command',
    command: verification.command,
    ...(verification.timeoutMs === undefined ? {} : { timeoutMs: verification.timeoutMs }),
    protectedPaths: verification.protectedPaths,
  };
}

function validateProtectedPaths(taskId: string, protectedPaths: unknown): asserts protectedPaths is string[] {
  if (!Array.isArray(protectedPaths)) {
    throw new Error(
      `task "${taskId}": verification.protectedPaths is required (an array; use [] when the verification reads nothing the agent can forge)`,
    );
  }
  for (const rel of protectedPaths) {
    if (typeof rel !== 'string' || isAbsolute(rel) || rel.split(/[\\/]+/).includes('..')) {
      throw new Error(`task "${taskId}": protectedPaths entry must be a workspace-relative path: ${String(rel)}`);
    }
  }
}
