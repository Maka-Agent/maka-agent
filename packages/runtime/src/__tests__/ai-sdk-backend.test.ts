import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import type { LlmConnection, SessionHeader } from '@maka/core';
import type { SessionEvent } from '@maka/core/events';
import type { ToolResultMessage } from '@maka/core/session';
import type { LlmCallRecord } from '@maka/core/usage-stats/types';
import {
  AiSdkBackend,
  INVALID_TOOL_NAME,
  MAX_ACTIVE_SUBAGENT_TOOLS_PER_TURN,
  TOOL_ERROR_RESULT_MAX_CHARS,
  formatSyntheticToolErrorText,
  normalizeAiSdkUsage,
  repairMakaToolCall,
  type MakaTool,
} from '../ai-sdk-backend.js';
import { PermissionEngine } from '../permission-engine.js';

describe('AiSdkBackend error surfaces', () => {
  test('generalizes model setup errors before emitting renderer events', async () => {
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header(),
      appendMessage: async () => {},
      connection: connection(),
      apiKey: 'sk-live-secret-token-value',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => {
        throw new Error('401 Authorization: Bearer sk-live-secret-token-value');
      },
      tools: [],
      newId: idGenerator(),
      now: () => 1,
    });

    const events: SessionEvent[] = [];
    for await (const event of backend.send({ turnId: 'turn-1', text: 'hi', context: [] })) {
      events.push(event);
    }

    const error = events.find((event): event is Extract<SessionEvent, { type: 'error' }> => event.type === 'error');
    assert.equal(error?.message, 'Authentication failed');
    assert.equal(JSON.stringify(events).includes('sk-live-secret-token-value'), false);
  });

  test('redacts and caps synthetic tool error text before storage and model return', () => {
    const raw = `provider exploded: Authorization: Bearer sk-live-secret-token-value ${'x'.repeat(5000)}`;
    const text = formatSyntheticToolErrorText(new Error(raw));

    assert.equal(text.includes('sk-live-secret-token-value'), false);
    assert.ok(text.includes('[redacted]'));
    assert.equal(text.length, TOOL_ERROR_RESULT_MAX_CHARS);
    assert.equal(text.endsWith('…'), true);
  });

  test('writeSyntheticToolResult never persists raw secret-shaped errors', async () => {
    const messages: ToolResultMessage[] = [];
    const events: SessionEvent[] = [];
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header(),
      appendMessage: async (message) => {
        if (message.type === 'tool_result') messages.push(message);
      },
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
    });

    await (backend as unknown as {
      writeSyntheticToolResult(
        toolUseId: string,
        turnId: string,
        text: string,
        queue: { push(event: SessionEvent): void },
      ): Promise<void>;
    }).writeSyntheticToolResult(
      'tool-1',
      'turn-1',
      'failed with api_key=sk-live-secret-token-value',
      { push: (event) => events.push(event) },
    );

    assert.equal(JSON.stringify(messages).includes('sk-live-secret-token-value'), false);
    assert.equal(JSON.stringify(events).includes('sk-live-secret-token-value'), false);
    assert.deepEqual(messages[0]?.content, events.find((event) => event.type === 'tool_result')?.content);
  });

  test('failed Bash results preserve terminal stdout and stderr as an error card', async () => {
    const messages: ToolResultMessage[] = [];
    const events: SessionEvent[] = [];
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header(),
      appendMessage: async (message) => {
        if (message.type === 'tool_result') messages.push(message);
      },
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
    });
    const tool: MakaTool = {
      name: 'Bash',
      description: 'shell',
      parameters: {},
      permissionRequired: false,
      impl: async () => {
        throw Object.assign(new Error('Command failed with exit code 2'), {
          code: 2,
          stdout: 'stdout before failure\nAuthorization: Bearer sk-live-secret-token-value',
          stderr: 'stderr before failure',
        });
      },
    };

    const execute = (backend as unknown as {
      wrapToolExecute(
        tool: MakaTool,
        turnId: string,
        queue: { push(event: SessionEvent): void },
      ): (args: unknown, ctx: { toolCallId: string; abortSignal: AbortSignal }) => Promise<unknown>;
    }).wrapToolExecute(tool, 'turn-1', { push: (event) => events.push(event) });

    const result = await execute(
      { command: 'printf out; printf err >&2; exit 2' },
      { toolCallId: 'tool-1', abortSignal: new AbortController().signal },
    );

    assert.deepEqual(result, { error: '命令退出码 2' });
    assert.equal(messages[0]?.isError, true);
    assert.deepEqual(messages[0]?.content, events.find((event) => event.type === 'tool_result')?.content);
    assert.deepEqual(messages[0]?.content, {
      kind: 'terminal',
      cwd: '/tmp/maka',
      cmd: 'printf out; printf err >&2; exit 2',
      exitCode: 2,
      stdout: 'stdout before failure\nAuthorization: Bearer [redacted]',
      stderr: 'stderr before failure',
    });
  });

  test('model stream timeout errors carry a stable reason for turn-history UI', () => {
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header(),
      appendMessage: async () => {},
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
    });

    const event = (backend as unknown as {
      makeErrorEvent(turnId: string, err: unknown): Extract<SessionEvent, { type: 'error' }>;
    }).makeErrorEvent('turn-1', new Error('Model stream idle timeout after 120000ms'));

    assert.equal(event.message, 'Request timed out');
    assert.equal(event.reason, 'timeout');
  });
});

describe('AiSdkBackend stop', () => {
  test('rejects parked permission requests for the active turn', async () => {
    const permissionEngine = new PermissionEngine({ newId: () => 'permission-id', now: () => 1 });
    permissionEngine.beginTurn('turn-1');
    const verdict = permissionEngine.evaluate({
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Write',
      args: { path: 'notes.md', content: 'hello' },
      mode: 'ask',
    });
    assert.equal(verdict.kind, 'prompt');
    assert.equal(permissionEngine.pendingCount('turn-1'), 1);
    const parked = verdict.kind === 'prompt'
      ? verdict.parked.then(
          () => 'resolved',
          (error: Error) => error.message,
        )
      : Promise.resolve('not-prompt');
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header(),
      appendMessage: async () => {},
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine,
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
    });

    (backend as unknown as { currentTurnId: string }).currentTurnId = 'turn-1';
    await backend.stop('user_stop');

    assert.match(await parked, /Turn turn-1 aborted before permission request permission-id was answered/);
    assert.equal(permissionEngine.pendingCount('turn-1'), 0);
  });
});

describe('AiSdkBackend usage telemetry', () => {
  test('normalizes standard LanguageModelUsage detail token fields', () => {
    const usage = normalizeAiSdkUsage({
      inputTokens: 100,
      outputTokens: 20,
      inputTokenDetails: {
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
      },
      outputTokenDetails: {
        reasoningTokens: 5,
      },
    });

    assert.deepEqual(usage, {
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 30,
      cacheWriteInputTokens: 10,
      reasoningTokens: 5,
      totalTokens: 120,
    });
  });

  test('normalizes cache and reasoning tokens to messages, events, and telemetry', async () => {
    const messages: unknown[] = [];
    const events: SessionEvent[] = [];
    const llmRecords: LlmCallRecord[] = [];
    const chunks: LanguageModelV3StreamPart[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'hello' },
      { type: 'text-end', id: 'text-1' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: 10,
            noCache: 5,
            cacheRead: 3,
            cacheWrite: 2,
          },
          outputTokens: {
            total: 7,
            text: 5,
            reasoning: 2,
          },
        },
      },
    ];
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks,
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      },
    });
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header(),
      appendMessage: async (message) => {
        messages.push(message);
      },
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'mock-model-id',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => model,
      tools: [],
      newId: idGenerator(),
      now: monotonicClock(),
      recordLlmCall: (record) => {
        llmRecords.push(record);
      },
    });

    for await (const event of backend.send({ turnId: 'turn-1', text: 'hi', context: [] })) {
      events.push(event);
    }

    const usageMessage = messages.find((message) =>
      (message as { type?: string }).type === 'token_usage'
    ) as { input?: number; output?: number; cacheRead?: number; cacheCreation?: number } | undefined;
    const usageEvent = events.find((event) => event.type === 'token_usage') as
      | Extract<SessionEvent, { type: 'token_usage' }>
      | undefined;

    assert.equal((usageMessage as { type?: string } | undefined)?.type, 'token_usage');
    assert.equal((usageMessage as { turnId?: string } | undefined)?.turnId, 'turn-1');
    assert.equal(usageMessage?.input, 10);
    assert.equal(usageMessage?.output, 7);
    assert.equal(usageMessage?.cacheRead, 3);
    assert.equal(usageMessage?.cacheCreation, 2);
    assert.equal(usageEvent?.input, 10);
    assert.equal(usageEvent?.output, 7);
    assert.equal(usageEvent?.cacheRead, 3);
    assert.equal(usageEvent?.cacheCreation, 2);
    assert.equal(llmRecords[0]?.inputTokens, 10);
    assert.equal(llmRecords[0]?.outputTokens, 7);
    assert.equal(llmRecords[0]?.cachedInputTokens, 3);
    assert.equal(llmRecords[0]?.cacheWriteInputTokens, 2);
    assert.equal(llmRecords[0]?.reasoningTokens, 2);
    assert.equal(llmRecords[0]?.totalTokens, 17);
  });
});

describe('AiSdkBackend tool permission category hints', () => {
  test('permission prompt timeout expires one request, resumes watchdog, and writes an error result', async () => {
    const messages: unknown[] = [];
    const events: SessionEvent[] = [];
    const permissionEngine = new PermissionEngine({ newId: idGenerator(), now: () => 1 });
    let implCalled = false;
    let pauseCount = 0;
    let resumeCount = 0;
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header('ask'),
      appendMessage: async (message) => {
        messages.push(message);
      },
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine,
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
      permissionTimeoutMs: 1,
    });
    const tool: MakaTool = {
      name: 'Write',
      description: 'write file',
      parameters: {},
      permissionRequired: true,
      impl: async () => {
        implCalled = true;
        return { ok: true };
      },
    };
    (backend as unknown as {
      currentWatchdog: { pause(): void; resume(): void };
    }).currentWatchdog = {
      pause: () => {
        pauseCount += 1;
      },
      resume: () => {
        resumeCount += 1;
      },
    };

    const execute = (backend as unknown as {
      wrapToolExecute(
        tool: MakaTool,
        turnId: string,
        queue: { push(event: SessionEvent): void },
      ): (args: unknown, ctx: { toolCallId: string; abortSignal: AbortSignal }) => Promise<unknown>;
    }).wrapToolExecute(tool, 'turn-1', { push: (event) => events.push(event) });

    const result = await execute(
      { path: 'notes.md', content: 'hello' },
      { toolCallId: 'tool-1', abortSignal: new AbortController().signal },
    );
    const permissionRequest = events.find((event) => event.type === 'permission_request') as
      | Extract<SessionEvent, { type: 'permission_request' }>
      | undefined;
    const toolResult = events.find((event) => event.type === 'tool_result') as
      | Extract<SessionEvent, { type: 'tool_result' }>
      | undefined;

    assert.equal(implCalled, false);
    assert.equal(pauseCount, 1);
    assert.equal(resumeCount, 1);
    assert.equal(permissionEngine.pendingCount('turn-1'), 0);
    assert.equal(permissionEngine.recordResponse('turn-1', {
      requestId: permissionRequest?.requestId ?? 'missing',
      decision: 'allow',
    }), null);
    assert.match((result as { error?: string }).error ?? '', /Permission flow aborted/);
    assert.match((result as { error?: string }).error ?? '', /timed out/);
    assert.equal(toolResult?.isError, true);
    assert.equal(
      messages.some((message) =>
        (message as { type?: string; toolUseId?: string; isError?: boolean }).type === 'tool_result' &&
        (message as { toolUseId?: string }).toolUseId === 'tool-1' &&
        (message as { isError?: boolean }).isError === true,
      ),
      true,
    );
  });

  test('passes categoryHint through PermissionEngine before tool execution', async () => {
    const messages: unknown[] = [];
    const events: SessionEvent[] = [];
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header('explore'),
      appendMessage: async (message) => {
        messages.push(message);
      },
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
    });
    const tool: MakaTool = {
      name: 'ExploreAgent',
      description: 'read-only worker',
      parameters: {},
      permissionRequired: true,
      categoryHint: 'subagent',
      impl: async () => ({ ok: true }),
    };

    const execute = (backend as unknown as {
      wrapToolExecute(
        tool: MakaTool,
        turnId: string,
        queue: { push(event: SessionEvent): void },
      ): (args: unknown, ctx: { toolCallId: string; abortSignal: AbortSignal }) => Promise<unknown>;
    }).wrapToolExecute(tool, 'turn-1', { push: (event) => events.push(event) });

    const result = await execute({ objective: 'map PawWork subagent lifecycle' }, {
      toolCallId: 'tool-1',
      abortSignal: new AbortController().signal,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(events.some((event) => event.type === 'permission_request'), false);
    assert.equal(messages.some((message) => (message as { type?: string }).type === 'tool_result'), true);
    assert.equal(
      (messages.find((message) => (message as { type?: string }).type === 'tool_call') as { intent?: string } | undefined)?.intent,
      '只读探索：map PawWork subagent lifecycle',
    );
    assert.equal(
      (events.find((event) => event.type === 'tool_start') as { intent?: string } | undefined)?.intent,
      '只读探索：map PawWork subagent lifecycle',
    );
  });

  test('caps concurrent read-only subagent tools in one turn', async () => {
    const messages: unknown[] = [];
    const events: SessionEvent[] = [];
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header('explore'),
      appendMessage: async (message) => {
        messages.push(message);
      },
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
    });
    let implStarted = 0;
    const release: Array<() => void> = [];
    const tool: MakaTool = {
      name: 'ExploreAgent',
      description: 'read-only worker',
      parameters: {},
      permissionRequired: true,
      categoryHint: 'subagent',
      impl: async () => {
        implStarted += 1;
        return new Promise((resolve) => {
          release.push(() => resolve({ ok: true }));
        });
      },
    };
    const execute = (backend as unknown as {
      wrapToolExecute(
        tool: MakaTool,
        turnId: string,
        queue: { push(event: SessionEvent): void },
      ): (args: unknown, ctx: { toolCallId: string; abortSignal: AbortSignal }) => Promise<unknown>;
    }).wrapToolExecute(tool, 'turn-1', { push: (event) => events.push(event) });

    const pending = Array.from({ length: MAX_ACTIVE_SUBAGENT_TOOLS_PER_TURN }, (_, index) => execute(
      { objective: `research ${index}` },
      { toolCallId: `tool-${index}`, abortSignal: new AbortController().signal },
    ));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(implStarted, MAX_ACTIVE_SUBAGENT_TOOLS_PER_TURN);

    const rejected = await execute(
      { objective: 'overflow' },
      { toolCallId: 'tool-overflow', abortSignal: new AbortController().signal },
    );
    assert.deepEqual(rejected, {
      error: '只读探索并发过多：同一轮最多 5 个子代理。请等待已有探索完成后再继续。',
    });
    assert.equal(implStarted, MAX_ACTIVE_SUBAGENT_TOOLS_PER_TURN);
    assert.equal(events.some((event) => event.type === 'tool_result' && event.toolUseId === 'tool-overflow' && event.isError), true);
    assert.equal(JSON.stringify(messages).includes('tool-overflow'), true);

    release.forEach((resume) => resume());
    await Promise.all(pending);
  });

  test('maps structured subagent terminal states to persisted tool status', async () => {
    const messages: unknown[] = [];
    const events: SessionEvent[] = [];
    const telemetry: Array<{ status: string; toolCallId?: string }> = [];
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header('explore'),
      appendMessage: async (message) => {
        messages.push(message);
      },
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
      recordToolInvocation: (record) => {
        telemetry.push({ status: record.status, toolCallId: record.toolCallId });
      },
    });
    const tool: MakaTool = {
      name: 'ExploreAgent',
      description: 'read-only worker',
      parameters: {},
      permissionRequired: true,
      categoryHint: 'subagent',
      impl: async (args: { reason?: string }) => ({
        kind: 'explore_agent',
        ok: false,
        mode: 'read_only',
        objective: 'bad scope',
        roots: [],
        queries: [],
        filesInspected: 0,
        filesSkipped: 0,
        bytesRead: 0,
        progress: [],
        candidateFiles: [],
        matches: [],
        notes: [],
        reason: args.reason === 'aborted' ? 'aborted' : 'invalid_root',
        message: args.reason === 'aborted' ? '只读探索已取消。' : '范围无效。',
      }),
    };
    const execute = (backend as unknown as {
      wrapToolExecute(
        tool: MakaTool,
        turnId: string,
        queue: { push(event: SessionEvent): void },
      ): (args: unknown, ctx: { toolCallId: string; abortSignal: AbortSignal }) => Promise<unknown>;
    }).wrapToolExecute(tool, 'turn-1', { push: (event) => events.push(event) });

    await execute({ objective: 'bad scope' }, {
      toolCallId: 'tool-failed',
      abortSignal: new AbortController().signal,
    });
    await execute({ objective: 'cancelled', reason: 'aborted' }, {
      toolCallId: 'tool-aborted',
      abortSignal: new AbortController().signal,
    });

    assert.equal(
      (messages.find((message) =>
        (message as { type?: string; toolUseId?: string }).type === 'tool_result' &&
        (message as { toolUseId?: string }).toolUseId === 'tool-failed',
      ) as { isError?: boolean } | undefined)?.isError,
      true,
    );
    assert.equal(
      (events.find((event) => event.type === 'tool_result' && event.toolUseId === 'tool-aborted') as { isError?: boolean } | undefined)?.isError,
      true,
    );
    assert.deepEqual(telemetry, [
      { status: 'error', toolCallId: 'tool-failed' },
      { status: 'aborted', toolCallId: 'tool-aborted' },
    ]);
  });

  test('maps aborted OfficeDocument results to aborted tool telemetry', async () => {
    const events: SessionEvent[] = [];
    const telemetry: Array<{ status: string; toolCallId?: string }> = [];
    const backend = new AiSdkBackend({
      sessionId: 'session-1',
      header: header('ask'),
      appendMessage: async () => {},
      connection: connection(),
      apiKey: 'sk-test',
      modelId: 'claude-sonnet-4-5-20250929',
      permissionEngine: new PermissionEngine({ newId: () => 'permission-id', now: () => 1 }),
      modelFactory: () => ({}),
      tools: [],
      newId: idGenerator(),
      now: () => 1,
      recordToolInvocation: (record) => {
        telemetry.push({ status: record.status, toolCallId: record.toolCallId });
      },
    });
    const tool: MakaTool = {
      name: 'OfficeDocument',
      description: 'read office',
      parameters: {},
      permissionRequired: false,
      impl: async () => ({
        kind: 'office_document',
        ok: false,
        operation: 'view',
        path: 'slides.pptx',
        args: ['view', 'slides.pptx', 'outline'],
        reason: 'officecli_aborted',
        message: 'officecli 操作已取消。',
      }),
    };
    const execute = (backend as unknown as {
      wrapToolExecute(
        tool: MakaTool,
        turnId: string,
        queue: { push(event: SessionEvent): void },
      ): (args: unknown, ctx: { toolCallId: string; abortSignal: AbortSignal }) => Promise<unknown>;
    }).wrapToolExecute(tool, 'turn-1', { push: (event) => events.push(event) });

    await execute({ path: 'slides.pptx', operation: 'view' }, {
      toolCallId: 'tool-office-aborted',
      abortSignal: new AbortController().signal,
    });

    assert.equal(
      (events.find((event) => event.type === 'tool_result') as { isError?: boolean } | undefined)?.isError,
      true,
    );
    assert.deepEqual(telemetry, [
      { status: 'aborted', toolCallId: 'tool-office-aborted' },
    ]);
  });
});

describe('AiSdkBackend tool-call repair', () => {
  test('repairs provider tool-name case drift to the canonical Maka tool name', () => {
    const repaired = repairMakaToolCall({
      toolCall: {
        toolCallId: 'tool-1',
        toolName: 'bash',
        input: '{"command":"pwd"}',
      },
      availableToolNames: ['Bash', 'Read'],
      error: new Error('No such tool'),
    });

    assert.equal(repaired?.toolName, 'Bash');
    assert.equal(repaired?.input, '{"command":"pwd"}');
  });

  test('routes unrepairable tool calls into the structured invalid tool', () => {
    const repaired = repairMakaToolCall({
      toolCall: {
        toolCallId: 'tool-1',
        toolName: 'DeleteEverything',
        input: '{"path":"/"}',
      },
      availableToolNames: ['Bash', 'Read'],
      error: new Error('No such tool: Authorization: Bearer sk-live-secret-token-value'),
    });

    assert.equal(repaired?.toolName, INVALID_TOOL_NAME);
    const input = JSON.parse(repaired?.input ?? '{}') as { tool?: string; error?: string };
    assert.equal(input.tool, 'DeleteEverything');
    assert.match(input.error ?? '', /No such tool/);
    assert.equal((input.error ?? '').includes('sk-live-secret-token-value'), false);
  });

  test('does not recursively repair the internal invalid tool', () => {
    const repaired = repairMakaToolCall({
      toolCall: {
        toolCallId: 'tool-1',
        toolName: INVALID_TOOL_NAME,
        input: '{}',
      },
      availableToolNames: ['Bash', 'Read'],
      error: new Error('Invalid tool failed'),
    });

    assert.equal(repaired, null);
  });
});

function header(permissionMode: SessionHeader['permissionMode'] = 'ask'): SessionHeader {
  return {
    id: 'session-1',
    workspaceRoot: '/tmp/maka',
    cwd: '/tmp/maka',
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
    model: 'claude-sonnet-4-5-20250929',
    permissionMode,
    schemaVersion: 1,
  };
}

function connection(): LlmConnection {
  return {
    slug: 'anthropic-main',
    name: 'Anthropic',
    providerType: 'anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function idGenerator(): () => string {
  let index = 0;
  return () => `id-${++index}`;
}

function monotonicClock(): () => number {
  let value = 1_000;
  return () => ++value;
}
