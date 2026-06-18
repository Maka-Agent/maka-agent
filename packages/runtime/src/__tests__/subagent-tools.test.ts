import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { LlmConnection, SessionHeader } from '@maka/core';
import type { SessionEvent } from '@maka/core/events';
import { buildBuiltinTools } from '../builtin-tools.js';
import { PermissionEngine } from '../permission-engine.js';
import {
  AGENT_LIST_TOOL_NAME,
  AGENT_OUTPUT_TOOL_NAME,
  AGENT_SPAWN_TOOL_NAME,
  buildChildAgentTools,
  buildSubagentListTool,
  buildSubagentOutputTool,
  buildSubagentSpawnTool,
} from '../subagent-tools.js';
import { ToolRuntime, type MakaTool } from '../tool-runtime.js';
import { expect } from '../test-helpers.js';

describe('subagent tools', () => {
  test('child agent toolset keeps only local non-prompting tools', () => {
    const tools = buildChildAgentTools([
      ...buildBuiltinTools(),
      {
        name: AGENT_SPAWN_TOOL_NAME,
        description: 'spawn',
        parameters: {},
        categoryHint: 'subagent',
        impl: async () => ({}),
      },
      {
        name: 'WebSearch',
        description: 'web',
        parameters: {},
        categoryHint: 'web_read',
        impl: async () => ({}),
      },
    ]);

    expect(tools.map((tool) => tool.name)).toEqual(['Bash', 'Read', 'Glob', 'Grep']);
  });

  test('child agent toolset enforces explore-mode read-only behavior without prompting', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'maka-child-tools-'));
    try {
      await writeFile(join(cwd, 'notes.txt'), 'SUBAGENT_CHILD_TOOL_MARKER\n', 'utf8');
      const events: SessionEvent[] = [];
      const runtime = makeChildToolRuntime(cwd);
      const tools = new Map(buildChildAgentTools(buildBuiltinTools()).map((tool) => [tool.name, tool]));

      await runTool(runtime, tools, 'Read', { path: 'notes.txt' }, events);
      await runTool(runtime, tools, 'Glob', { pattern: '*.txt' }, events);
      await runTool(runtime, tools, 'Grep', { pattern: 'SUBAGENT_CHILD_TOOL_MARKER' }, events);
      await runTool(runtime, tools, 'Bash', { command: 'pwd' }, events);
      const unsafe = await runTool(runtime, tools, 'Bash', { command: 'node -e "console.log(1)"' }, events);

      expect(events.some((event) => event.type === 'permission_request')).toBe(false);
      expect((unsafe as { error?: string }).error).toBeDefined();
      expect(events.some((event) =>
        event.type === 'tool_result' &&
        event.toolUseId === 'tool-Bash-node -e "console.log(1)"' &&
        event.isError
      )).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('agent_spawn delegates through the narrow tool context capability', async () => {
    const tool = buildSubagentSpawnTool();
    const abortController = new AbortController();
    const calls: unknown[] = [];

    const result = await tool.impl({
      agent_name: 'Researcher',
      instructions: 'Stay read-only.',
      prompt: 'Inspect the runtime tests.',
    }, {
      sessionId: 'session-1',
      turnId: 'parent-turn',
      cwd: '/tmp/cwd',
      toolCallId: 'tool-1',
      abortSignal: abortController.signal,
      emitOutput: () => {},
      spawnChildAgent: async (input) => {
        calls.push(input);
        return {
          agentName: input.spec.name,
          turnId: 'child-turn',
          status: 'completed',
          permissionMode: 'explore',
          summary: 'done',
          artifactIds: [],
        };
      },
    });

    expect(tool.name).toBe(AGENT_SPAWN_TOOL_NAME);
    expect(tool.categoryHint).toBe('subagent');
    expect(tool.permissionRequired).toBe(true);
    expect(calls).toEqual([{
      spec: {
        name: 'Researcher',
        systemPrompt: 'Stay read-only.',
      },
      prompt: 'Inspect the runtime tests.',
    }]);
    expect(result).toEqual({
      kind: 'subagent',
      agentName: 'Researcher',
      turnId: 'child-turn',
      status: 'completed',
      permissionMode: 'explore',
      summary: 'done',
      artifactIds: [],
    });
  });

  test('agent projection tools delegate through read-only context capabilities', async () => {
    const listTool = buildSubagentListTool();
    const outputTool = buildSubagentOutputTool();

    const list = await listTool.impl({}, {
      sessionId: 'session-1',
      turnId: 'parent-turn',
      cwd: '/tmp/cwd',
      toolCallId: 'tool-list',
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
      listChildAgents: async () => ({ agents: [{ runId: 'child-run', turnId: 'child-turn' }] }),
    });
    const output = await outputTool.impl({ run_id: 'child-run' }, {
      sessionId: 'session-1',
      turnId: 'parent-turn',
      cwd: '/tmp/cwd',
      toolCallId: 'tool-output',
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
      readChildAgentOutput: async (input) => ({ requested: input }),
    });

    expect(listTool.name).toBe(AGENT_LIST_TOOL_NAME);
    expect(outputTool.name).toBe(AGENT_OUTPUT_TOOL_NAME);
    expect(listTool.permissionRequired).toBe(false);
    expect(outputTool.permissionRequired).toBe(false);
    expect(list).toEqual({ agents: [{ runId: 'child-run', turnId: 'child-turn' }] });
    expect(output).toEqual({ requested: { runId: 'child-run' } });
  });

  test('agent_output requires exactly one run locator', () => {
    const outputTool = buildSubagentOutputTool();
    const schema = outputTool.parameters as { safeParse(input: unknown): { success: boolean } };

    expect(schema.safeParse({ run_id: 'child-run' }).success).toBe(true);
    expect(schema.safeParse({ turn_id: 'child-turn' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ run_id: 'child-run', turn_id: 'child-turn' }).success).toBe(false);
  });
});

function makeChildToolRuntime(cwd: string): ToolRuntime {
  const permissionEngine = new PermissionEngine({ newId: nextId(), now: () => 1 });
  permissionEngine.beginTurn('child-turn');
  return new ToolRuntime({
    sessionId: 'session-1',
    header: childHeader(cwd),
    connection: testConnection(),
    modelId: 'mock-model',
    appendMessage: async () => {},
    permissionEngine,
    newId: nextId(),
    now: () => 1,
    getPermissionPauseTarget: () => null,
  });
}

async function runTool(
  runtime: ToolRuntime,
  tools: Map<string, MakaTool>,
  name: string,
  args: unknown,
  events: SessionEvent[],
): Promise<unknown> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Missing child tool ${name}`);
  return await runtime.wrapToolExecute(tool, 'child-turn', {
    push: (event) => events.push(event),
  })(args, {
    toolCallId: `tool-${name}-${typeof args === 'object' && args && 'command' in args ? (args as { command: string }).command : 'read'}`,
    abortSignal: new AbortController().signal,
  });
}

function childHeader(cwd: string): SessionHeader {
  return {
    id: 'session-1',
    workspaceRoot: cwd,
    cwd,
    createdAt: 1,
    lastUsedAt: 1,
    name: 'Test',
    isFlagged: false,
    labels: [],
    isArchived: false,
    status: 'active',
    statusUpdatedAt: 1,
    hasUnread: false,
    backend: 'ai-sdk',
    llmConnectionSlug: 'anthropic-main',
    connectionLocked: true,
    model: 'mock-model',
    permissionMode: 'explore',
    schemaVersion: 1,
  };
}

function testConnection(): LlmConnection {
  return {
    slug: 'anthropic-main',
    name: 'Anthropic',
    providerType: 'anthropic',
    defaultModel: 'mock-model',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function nextId(): () => string {
  let id = 0;
  return () => `id-${++id}`;
}
