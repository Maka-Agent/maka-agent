import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readFixedPromptWal } from './fixed-prompt-controller.js';
import { derivePromptOptimizationReplayState } from './prompt-optimization-replay.js';

const execFileAsync = promisify(execFile);

export interface EnsurePromptOptimizationPromptRepoInput {
  promptRepoDir: string;
  program: string;
  systemPrompt: string;
}

export interface PromptOptimizationPromptRepoPaths {
  agentCwdPath: string;
  programPath: string;
  systemPromptPath: string;
}

export async function ensurePromptOptimizationPromptRepo(
  input: EnsurePromptOptimizationPromptRepoInput,
): Promise<PromptOptimizationPromptRepoPaths> {
  const agentCwdPath = join(input.promptRepoDir, 'agent-cwd');
  const programPath = join(input.promptRepoDir, 'program.md');
  const systemPromptPath = join(input.promptRepoDir, 'system_prompt.md');
  await mkdir(agentCwdPath, { recursive: true });

  if (await pathExists(join(input.promptRepoDir, '.git'))) {
    if (!(await hasHead(input.promptRepoDir))) {
      await ensureSeedFiles(input);
      await commitSeed(input.promptRepoDir);
      return { agentCwdPath, programPath, systemPromptPath };
    }
    await assertExistingSeedFile(programPath, input.program);
    if (await promptRepoHeadIsSeed(input.promptRepoDir)) {
      await assertExistingSeedFile(systemPromptPath, input.systemPrompt);
    }
    return { agentCwdPath, programPath, systemPromptPath };
  }

  await ensureSeedFiles(input);
  await git(input.promptRepoDir, 'init', '-q');
  await commitSeed(input.promptRepoDir);
  return { agentCwdPath, programPath, systemPromptPath };
}

export async function assertPromptOptimizationResumeSupported(input: {
  promptRepoDir: string;
  resultsJsonlPath: string;
}): Promise<void> {
  const events = await readFixedPromptWal(input.resultsJsonlPath);
  const head = await gitOutput(input.promptRepoDir, 'rev-parse', 'HEAD');
  const replayState = await derivePromptOptimizationReplayState({
    events,
    promptRepoDir: input.promptRepoDir,
  });
  const expectedHead = replayState.expectedPromptRepoHead;
  if (head !== expectedHead) {
    throw new Error(`prompt repo HEAD does not match resumed RSI WAL state: expected ${expectedHead}, got ${head}`);
  }
}

async function promptRepoHeadIsSeed(promptRepoDir: string): Promise<boolean> {
  const head = await gitOutput(promptRepoDir, 'rev-parse', 'HEAD');
  const seedCommitSha = await gitOutput(promptRepoDir, 'rev-list', '--max-parents=0', 'HEAD');
  return head === seedCommitSha;
}

async function assertExistingSeedFile(path: string, expected: string): Promise<void> {
  const actual = await readFile(path, 'utf8');
  if (actual !== expected) {
    throw new Error(`existing prompt repo seed files do not match this run: ${path}`);
  }
}

async function ensureSeedFiles(input: EnsurePromptOptimizationPromptRepoInput): Promise<void> {
  const programPath = join(input.promptRepoDir, 'program.md');
  const systemPromptPath = join(input.promptRepoDir, 'system_prompt.md');
  await mkdir(input.promptRepoDir, { recursive: true });
  await ensureSeedFile(programPath, input.program);
  await ensureSeedFile(systemPromptPath, input.systemPrompt);
}

async function ensureSeedFile(path: string, expected: string): Promise<void> {
  try {
    await assertExistingSeedFile(path, expected);
  } catch (error) {
    if (isNotFound(error)) {
      await writeFile(path, expected, 'utf8');
      return;
    }
    throw error;
  }
}

async function commitSeed(promptRepoDir: string): Promise<void> {
  await git(promptRepoDir, 'config', 'user.email', 'rsi@maka.local');
  await git(promptRepoDir, 'config', 'user.name', 'RSI Loop');
  await git(promptRepoDir, 'add', 'program.md', 'system_prompt.md');
  await git(promptRepoDir, 'commit', '-q', '-m', 'seed prompt');
}

async function hasHead(promptRepoDir: string): Promise<boolean> {
  try {
    await gitOutput(promptRepoDir, 'rev-parse', '--verify', 'HEAD');
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function gitOutput(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout.trim();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}
