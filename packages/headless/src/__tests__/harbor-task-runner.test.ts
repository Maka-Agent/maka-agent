import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { tokenSummary } from './helpers/cell-output-fixtures.js';
import type { HarborCellOutput } from '../cell-output.js';
import type { HarborTaskRunInput } from '../fixed-prompt-controller.js';
import {
  buildHarborJobConfig,
  createHarborTaskRunner,
  HarborInfraError,
  type HarborProcessRunner,
  type HarborRunResult,
} from '../harbor-task-runner.js';

function cellOutput(overrides: Partial<HarborCellOutput> = {}): HarborCellOutput {
  return {
    schemaVersion: 1,
    status: 'completed',
    runtimeEventsPath: '/logs/agent/runtime-events.jsonl',
    promptHash: 'sha256:abc',
    tokenSummary: tokenSummary({ input: 100, output: 50, reasoning: 0, total: 150, costUsd: 0.0001 }),
    toolSummary: {
      providerVisibleToolCount: 6,
      actualToolCalls: 2,
      actualToolNames: ['Bash'],
      actualToolCallCounts: { Bash: 2 },
    },
    steps: 3,
    durationMs: 1000,
    startedAt: 1,
    finishedAt: 2,
    runtimeRefs: { invocationId: 'inv', sessionId: 'sess', runId: 'run', turnId: 'turn' },
    ...overrides,
  };
}

function runInput(overrides: Partial<HarborTaskRunInput> = {}): HarborTaskRunInput {
  return {
    runId: 'run-1',
    roundId: 'round-1',
    task: { id: 'task-1', path: '/tasks/cobol-modernization' },
    config: { id: 'cfg', backend: 'ai-sdk', llmConnectionSlug: 'deepseek', model: 'deepseek-v4-flash' },
    systemPrompt: 'CANDIDATE PROMPT\n',
    ...overrides,
  };
}

interface FakeOptions {
  reward?: string;
  cell?: HarborCellOutput | null;
  exitCode?: number;
  events?: string;
  captured?: { config?: Record<string, unknown> };
}

function fakeRunner(opts: FakeOptions): HarborProcessRunner {
  return async (request): Promise<HarborRunResult> => {
    const config = JSON.parse(await readFile(request.configPath, 'utf8')) as Record<string, unknown>;
    if (opts.captured) opts.captured.config = config;
    if (opts.exitCode && opts.exitCode !== 0) {
      return { exitCode: opts.exitCode, stdout: '', stderr: 'container build failed' };
    }
    const tasks = config.tasks as Array<{ path: string }>;
    const taskName = tasks[0]!.path.split('/').pop()!;
    const trialDir = join(request.jobsDir, request.jobName, `${taskName}__t1`);
    await mkdir(join(trialDir, 'verifier'), { recursive: true });
    await mkdir(join(trialDir, 'agent'), { recursive: true });
    if (opts.reward !== undefined) {
      await writeFile(join(trialDir, 'verifier', 'reward.txt'), opts.reward, 'utf8');
    }
    if (opts.cell !== null) {
      await writeFile(join(trialDir, 'agent', 'maka-cell-output.json'), JSON.stringify(opts.cell ?? cellOutput()), 'utf8');
    }
    await writeFile(join(trialDir, 'agent', 'runtime-events.jsonl'), opts.events ?? '{"type":"x"}\n', 'utf8');
    return { exitCode: 0, stdout: 'ok', stderr: '' };
  };
}

async function withRun<T>(fn: (dirs: { jobsDir: string; repo: string; keyFile: string }) => Promise<T>): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'maka-harbor-runner-'));
  const repo = join(base, 'repo');
  const jobsDir = join(base, 'jobs');
  const keyFile = join(base, 'deepseek-key');
  await mkdir(repo, { recursive: true });
  await writeFile(keyFile, 'sk-secret\n', 'utf8');
  try {
    return await fn({ jobsDir, repo, keyFile });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

describe('createHarborTaskRunner', () => {
  test('parses reward + cell output and rewrites runtime events to the host path', async () => {
    await withRun(async ({ jobsDir, repo, keyFile }) => {
      const runner = createHarborTaskRunner({
        makaRepoPath: repo,
        jobsDir,
        model: 'deepseek/deepseek-v4-flash',
        provider: 'deepseek',
        apiKeyFile: keyFile,
        pricing: { inputUsdPer1M: 0.145, outputUsdPer1M: 0.29, cacheReadUsdPer1M: 0.0029, source: 'v4-flash' },
        runHarbor: fakeRunner({ reward: '1\n', cell: cellOutput({ promptHash: 'sha256:candidate' }) }),
      });

      const output = await runner(runInput());
      assert.equal(output.harbor.reward, 1);
      assert.equal(output.cell.status, 'completed');
      assert.equal(output.cell.promptHash, 'sha256:candidate');
      // runtimeEventsPath must be the host trial path, not the container path.
      assert.match(output.cell.runtimeEventsPath, /run-1\/round-1\/task-1\/trial\/cobol-modernization__t1\/agent\/runtime-events\.jsonl$/);
      assert.doesNotMatch(output.cell.runtimeEventsPath, /^\/logs\//);
    });
  });

  test('generates a JobConfig with verbatim prompt, key-file mount, and trial pricing', async () => {
    await withRun(async ({ jobsDir, repo, keyFile }) => {
      const captured: { config?: Record<string, unknown> } = {};
      const runner = createHarborTaskRunner({
        makaRepoPath: repo,
        jobsDir,
        model: 'deepseek/deepseek-v4-flash',
        provider: 'deepseek',
        apiKeyFile: keyFile,
        pricing: { inputUsdPer1M: 0.145, outputUsdPer1M: 0.29, cacheReadUsdPer1M: 0.0029, source: 'v4-flash' },
        agentEnv: { DEEPSEEK_BASE_URL: 'https://api.deepseek.com' },
        runHarbor: fakeRunner({ reward: '0\n', captured }),
      });
      await runner(runInput({ systemPrompt: 'PROMPT WITH\nNEWLINES\n' }));

      const config = captured.config!;
      const agent = (config.agents as Array<Record<string, unknown>>)[0]!;
      const env = agent.env as Record<string, string>;
      assert.equal(agent.import_path, 'maka_agent:MakaAgent');
      assert.equal(config.n_attempts, 1);
      assert.equal(config.n_concurrent_trials, 1);
      assert.equal(env.MAKA_BACKEND, 'ai-sdk');
      assert.equal(env.MAKA_MODEL, 'deepseek/deepseek-v4-flash');
      // Byte-for-byte, including the trailing newline the controller hashes.
      assert.equal(env.MAKA_SYSTEM_PROMPT, 'PROMPT WITH\nNEWLINES\n');
      assert.equal(env.DEEPSEEK_API_KEY_FILE, '/run/secrets/deepseek-key');
      assert.equal(env.MAKA_TRIAL_INPUT_USD_PER_1M, '0.145');
      assert.equal(env.MAKA_TRIAL_OUTPUT_USD_PER_1M, '0.29');
      assert.equal(env.MAKA_TRIAL_CACHE_READ_USD_PER_1M, '0.0029');
      assert.equal(env.MAKA_TRIAL_PRICING_SOURCE, 'v4-flash');
      assert.equal(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com');
      const mounts = (config.environment as { mounts: Array<Record<string, unknown>> }).mounts;
      assert.ok(mounts.some((m) => m.target === '/opt/maka-agent' && m.read_only === true));
      assert.ok(mounts.some((m) => m.target === '/run/secrets/deepseek-key' && m.source === keyFile));
      assert.deepEqual(config.tasks, [{ path: '/tasks/cobol-modernization', overwrite: false }]);
    });
  });

  test('throws HarborInfraError when harbor exits non-zero', async () => {
    await withRun(async ({ jobsDir, repo }) => {
      const runner = createHarborTaskRunner({
        makaRepoPath: repo,
        jobsDir,
        model: 'deepseek/deepseek-v4-flash',
        runHarbor: fakeRunner({ exitCode: 1 }),
      });
      await assert.rejects(runner(runInput()), HarborInfraError);
    });
  });

  test('throws HarborInfraError when the cell output is missing', async () => {
    await withRun(async ({ jobsDir, repo }) => {
      const runner = createHarborTaskRunner({
        makaRepoPath: repo,
        jobsDir,
        model: 'deepseek/deepseek-v4-flash',
        runHarbor: fakeRunner({ reward: '1\n', cell: null }),
      });
      await assert.rejects(runner(runInput()), HarborInfraError);
    });
  });

  test('throws HarborInfraError when the verifier reward is missing', async () => {
    await withRun(async ({ jobsDir, repo }) => {
      const runner = createHarborTaskRunner({
        makaRepoPath: repo,
        jobsDir,
        model: 'deepseek/deepseek-v4-flash',
        runHarbor: fakeRunner({ cell: cellOutput() }),
      });
      await assert.rejects(runner(runInput()), HarborInfraError);
    });
  });

  test('returns an unscored failed cell without throwing (model API failure path)', async () => {
    await withRun(async ({ jobsDir, repo }) => {
      const runner = createHarborTaskRunner({
        makaRepoPath: repo,
        jobsDir,
        model: 'deepseek/deepseek-v4-flash',
        runHarbor: fakeRunner({
          reward: '0\n',
          cell: cellOutput({ status: 'failed', errorClass: 'runtime_error' }),
        }),
      });
      const output = await runner(runInput());
      assert.equal(output.harbor.reward, 0);
      assert.equal(output.cell.status, 'failed');
      assert.equal(output.cell.errorClass, 'runtime_error');
    });
  });
});

describe('buildHarborJobConfig', () => {
  test('omits pricing env when no pricing is configured', () => {
    const config = buildHarborJobConfig(runInput(), {
      makaRepoPath: '/repo',
      jobsDir: '/jobs/x',
      jobName: 'trial',
      model: 'deepseek/deepseek-v4-flash',
    });
    const env = (config.agents as Array<{ env: Record<string, string> }>)[0]!.env;
    assert.equal(env.MAKA_TRIAL_INPUT_USD_PER_1M, undefined);
    assert.equal(env.MAKA_BACKEND, 'ai-sdk');
  });
});
