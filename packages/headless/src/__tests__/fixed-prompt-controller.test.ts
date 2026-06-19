import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { Config } from '../contracts.js';
import {
  runFixedPromptController,
  type FixedPromptWalEvent,
  type HarborTaskRunOutput,
} from '../fixed-prompt-controller.js';

const config: Config = {
  id: 'cfg-fixed',
  backend: 'fake',
  llmConnectionSlug: 'fake',
  model: 'fake-model',
};

describe('fixed prompt controller', () => {
  test('resumes from completed task events in the WAL', async () => {
    await withDir(async (dir) => {
      const systemPromptPath = join(dir, 'system_prompt.md');
      const resultsJsonlPath = join(dir, 'results.jsonl');
      await writeFile(systemPromptPath, 'fixed prompt\n', 'utf8');
      await appendFile(resultsJsonlPath, `${JSON.stringify(taskCompletedEvent({ taskId: 'task-a' }))}\n`, 'utf8');

      const calls: string[] = [];
      const result = await runFixedPromptController({
        runId: 'run-1',
        roundId: 'round-1',
        config,
        systemPromptPath,
        resultsJsonlPath,
        resultsTsvPath: join(dir, 'results.tsv'),
        tasks: [
          { id: 'task-a', path: '/bench/task-a' },
          { id: 'task-b', path: '/bench/task-b' },
        ],
        harborRunner: async ({ task }): Promise<HarborTaskRunOutput> => {
          calls.push(task.id);
          return harborOutput({ taskId: task.id });
        },
        now: () => 100,
        newId: idFactory(),
      });

      assert.deepEqual(calls, ['task-b']);
      assert.deepEqual(result.taskIds, ['task-a', 'task-b']);

      const lines = (await readFile(resultsJsonlPath, 'utf8')).trimEnd().split('\n');
      assert.equal(lines.length, 2);
      assert.equal(JSON.parse(lines[1]!).taskId, 'task-b');
    });
  });

  test('derives results TSV from replayed task events', async () => {
    await withDir(async (dir) => {
      const systemPromptPath = join(dir, 'system_prompt.md');
      const resultsJsonlPath = join(dir, 'results.jsonl');
      const resultsTsvPath = join(dir, 'results.tsv');
      await writeFile(systemPromptPath, 'fixed prompt\n', 'utf8');
      await appendFile(resultsJsonlPath, `${JSON.stringify(taskCompletedEvent({ taskId: 'task-a' }))}\n`, 'utf8');

      await runFixedPromptController({
        runId: 'run-1',
        roundId: 'round-1',
        config,
        systemPromptPath,
        resultsJsonlPath,
        resultsTsvPath,
        tasks: [{ id: 'task-a', path: '/bench/task-a' }],
        harborRunner: async () => harborOutput({ taskId: 'unused' }),
        now: () => 100,
        newId: idFactory(),
      });

      assert.equal(
        await readFile(resultsTsvPath, 'utf8'),
        [
          'task_id\tstatus\tpassed\tscored\teligible\terror_class\tprompt_hash\ttokens\tcost_usd\truntime_events_path',
          'task-a\tcompleted\ttrue\ttrue\ttrue\t\tsha256:prompt\t5\t0.01\t/logs/task-a/runtime-events.jsonl',
          '',
        ].join('\n'),
      );
    });
  });
});

function taskCompletedEvent(input: { taskId: string }): FixedPromptWalEvent {
  return {
    schemaVersion: 1,
    type: 'task_completed',
    id: `event-${input.taskId}`,
    ts: 10,
    runId: 'run-1',
    roundId: 'round-1',
    taskId: input.taskId,
    status: 'completed',
    passed: true,
    scored: true,
    eligible: true,
    promptHash: 'sha256:prompt',
    tokenSummary: { input: 2, output: 3, reasoning: 0, total: 5, costUsd: 0.01 },
    steps: 4,
    durationMs: 50,
    runtimeEventsPath: `/logs/${input.taskId}/runtime-events.jsonl`,
    harbor: { reward: 1 },
  };
}

function harborOutput(input: { taskId: string }): HarborTaskRunOutput {
  return {
    harbor: { reward: 1 },
    cell: {
      schemaVersion: 1,
      status: 'completed',
      runtimeEventsPath: `/logs/${input.taskId}/runtime-events.jsonl`,
      promptHash: 'sha256:prompt',
      tokenSummary: { input: 1, output: 2, reasoning: 0, total: 3, costUsd: 0.02 },
      steps: 2,
      durationMs: 40,
      startedAt: 20,
      finishedAt: 60,
      runtimeRefs: {
        invocationId: `inv-${input.taskId}`,
        sessionId: `session-${input.taskId}`,
        runId: `run-${input.taskId}`,
        turnId: `turn-${input.taskId}`,
      },
    },
  };
}

function idFactory(): () => string {
  let i = 0;
  return () => `id-${++i}`;
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'maka-fixed-prompt-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
