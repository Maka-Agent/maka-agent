import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HarborCellOutput, HarborCellTokenSummary } from './cell-output.js';
import type { Config } from './contracts.js';

export const FIXED_PROMPT_WAL_SCHEMA_VERSION = 1;

export interface FixedPromptTask {
  id: string;
  path: string;
}

export interface HarborTaskRunOutput {
  harbor: {
    reward: number;
  };
  cell: HarborCellOutput;
}

export interface HarborTaskRunInput {
  runId: string;
  roundId: string;
  task: FixedPromptTask;
  config: Config;
  systemPrompt: string;
}

export type HarborTaskRunner = (input: HarborTaskRunInput) => Promise<HarborTaskRunOutput>;

export interface FixedPromptTaskCompletedEvent {
  schemaVersion: typeof FIXED_PROMPT_WAL_SCHEMA_VERSION;
  type: 'task_completed';
  id: string;
  ts: number;
  runId: string;
  roundId: string;
  taskId: string;
  status: HarborCellOutput['status'];
  passed: boolean;
  scored: boolean;
  eligible: boolean;
  errorClass?: string;
  promptHash?: string;
  tokenSummary: HarborCellTokenSummary;
  steps: number;
  durationMs: number;
  runtimeEventsPath: string;
  harbor: {
    reward: number;
  };
}

export type FixedPromptWalEvent = FixedPromptTaskCompletedEvent;

export interface RunFixedPromptControllerInput {
  runId: string;
  roundId: string;
  config: Config;
  systemPromptPath: string;
  resultsJsonlPath: string;
  resultsTsvPath: string;
  tasks: readonly FixedPromptTask[];
  harborRunner: HarborTaskRunner;
  now?: () => number;
  newId?: () => string;
}

export interface FixedPromptControllerResult {
  taskIds: string[];
  events: FixedPromptWalEvent[];
  totalTokens: number;
  totalCostUsd: number;
  resultsTsvPath: string;
}

export async function runFixedPromptController(
  input: RunFixedPromptControllerInput,
): Promise<FixedPromptControllerResult> {
  const now = input.now ?? Date.now;
  const newId = input.newId ?? randomId;
  const systemPrompt = await readFile(input.systemPromptPath, 'utf8');
  const config = { ...input.config, systemPrompt };
  const events = await readFixedPromptWal(input.resultsJsonlPath);
  const completed = completedTaskEvents(events, input.runId, input.roundId);

  for (const task of input.tasks) {
    if (completed.has(task.id)) continue;

    const output = await input.harborRunner({
      runId: input.runId,
      roundId: input.roundId,
      task,
      config,
      systemPrompt,
    });
    const event = taskCompletedEvent({
      output,
      taskId: task.id,
      runId: input.runId,
      roundId: input.roundId,
      id: newId(),
      ts: now(),
    });
    await appendFixedPromptWalEvent(input.resultsJsonlPath, event);
    events.push(event);
    completed.set(task.id, event);
  }

  const resultEvents = input.tasks
    .map((task) => completed.get(task.id))
    .filter((event): event is FixedPromptWalEvent => event !== undefined);
  await writeFixedPromptResultsTsv(input.resultsTsvPath, resultEvents);

  return {
    taskIds: resultEvents.map((event) => event.taskId),
    events: resultEvents,
    totalTokens: sum(resultEvents.map((event) => event.tokenSummary.total)),
    totalCostUsd: sum(resultEvents.map((event) => event.tokenSummary.costUsd)),
    resultsTsvPath: input.resultsTsvPath,
  };
}

export async function readFixedPromptWal(path: string): Promise<FixedPromptWalEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FixedPromptWalEvent);
}

export async function appendFixedPromptWalEvent(path: string, event: FixedPromptWalEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8');
}

export async function writeFixedPromptResultsTsv(
  path: string,
  events: readonly FixedPromptWalEvent[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const header = [
    'task_id',
    'status',
    'passed',
    'scored',
    'eligible',
    'error_class',
    'prompt_hash',
    'tokens',
    'cost_usd',
    'runtime_events_path',
  ];
  const rows = events.map((event) => [
    event.taskId,
    event.status,
    String(event.passed),
    String(event.scored),
    String(event.eligible),
    event.errorClass ?? '',
    event.promptHash ?? '',
    String(event.tokenSummary.total),
    String(event.tokenSummary.costUsd),
    event.runtimeEventsPath,
  ]);
  const body = [header, ...rows].map((row) => row.map(tsvCell).join('\t')).join('\n');
  await writeFile(path, `${body}\n`, 'utf8');
}

function taskCompletedEvent(input: {
  output: HarborTaskRunOutput;
  taskId: string;
  runId: string;
  roundId: string;
  id: string;
  ts: number;
}): FixedPromptTaskCompletedEvent {
  const { output } = input;
  return {
    schemaVersion: FIXED_PROMPT_WAL_SCHEMA_VERSION,
    type: 'task_completed',
    id: input.id,
    ts: input.ts,
    runId: input.runId,
    roundId: input.roundId,
    taskId: input.taskId,
    status: output.cell.status,
    passed: output.cell.status === 'completed' && output.harbor.reward > 0,
    scored: output.cell.status === 'completed',
    eligible: true,
    ...(output.cell.errorClass ? { errorClass: output.cell.errorClass } : {}),
    ...(output.cell.promptHash ? { promptHash: output.cell.promptHash } : {}),
    tokenSummary: output.cell.tokenSummary,
    steps: output.cell.steps,
    durationMs: output.cell.durationMs,
    runtimeEventsPath: output.cell.runtimeEventsPath,
    harbor: {
      reward: output.harbor.reward,
    },
  };
}

function completedTaskEvents(
  events: readonly FixedPromptWalEvent[],
  runId: string,
  roundId: string,
): Map<string, FixedPromptWalEvent> {
  const byTask = new Map<string, FixedPromptWalEvent>();
  for (const event of events) {
    if (event.runId !== runId || event.roundId !== roundId) continue;
    if (event.type === 'task_completed') byTask.set(event.taskId, event);
  }
  return byTask;
}

function tsvCell(value: string): string {
  return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function randomId(): string {
  return randomUUID();
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
