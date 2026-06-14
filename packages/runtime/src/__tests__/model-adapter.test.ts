import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SessionEvent } from '@maka/core/events';

import { AsyncEventQueue } from '../async-queue.js';
import {
  ModelAdapter,
  normalizeAiSdkUsage,
  type AiSdkStreamChunk,
} from '../model-adapter.js';

describe('ModelAdapter stream and error normalization', () => {
  test('normalizes provider text, reasoning, ignored tool chunks, and errors into SessionEvents', () => {
    const events: SessionEvent[] = [];
    const queue = new AsyncEventQueue<SessionEvent>();
    const adapter = newAdapter();
    const callbacks = {
      text: '',
      thinking: '',
      onText(text: string) {
        this.text += text;
      },
      onTextComplete(text: string) {
        this.text = text;
      },
      onThinking(text: string) {
        this.thinking += text;
      },
      onThinkingComplete(text: string) {
        this.thinking = text;
      },
    };
    const push = queue.push.bind(queue);
    queue.push = (event: SessionEvent) => {
      events.push(event);
      push(event);
    };

    const chunks: AiSdkStreamChunk[] = [
      { type: 'text-delta', text: 'hello ' },
      { type: 'text-delta', textDelta: 'world' },
      { type: 'reasoning', delta: 'think ' },
      { type: 'reasoning-delta', text: 'more' },
      { type: 'tool-call', toolCallId: 'tool-1', toolName: 'Read' },
      { type: 'tool-result', toolCallId: 'tool-1', result: { ok: true } },
      { type: 'error', error: Object.assign(new Error('429 rate limit'), { code: 429 }) },
      { type: 'unknown-provider-chunk' },
    ];

    for (const chunk of chunks) {
      adapter.handleStreamChunk(chunk, 'turn-1', 'assistant-1', queue, callbacks);
    }

    assert.equal(callbacks.text, 'hello world');
    assert.equal(callbacks.thinking, 'think more');
    assert.deepEqual(
      events.map((event) => event.type),
      ['text_delta', 'text_delta', 'thinking_delta', 'thinking_delta', 'error'],
    );
    assert.deepEqual(
      events
        .filter((event) => event.type === 'text_delta')
        .map((event) => event.text),
      ['hello ', 'world'],
    );
    assert.deepEqual(
      events
        .filter((event) => event.type === 'thinking_delta')
        .map((event) => event.text),
      ['think ', 'more'],
    );
    const error = events.find((event) => event.type === 'error') as Extract<SessionEvent, { type: 'error' }> | undefined;
    assert.equal(error?.reason, 'rate_limit');
    assert.equal(error?.code, '429');
    assert.equal(error?.message, 'Rate limit exceeded');
  });

  test('classifies provider errors and maps finish reasons through adapter-owned helpers', () => {
    const adapter = newAdapter();

    assert.equal(adapter.classifyError(Object.assign(new Error('401 Authorization'), { code: 401 })), 'Auth');
    assert.equal(adapter.makeErrorEvent('turn-1', new Error('Model stream idle timeout after 120000ms')).reason, 'timeout');
    assert.equal(adapter.mapFinishReason('stop'), 'end_turn');
    assert.equal(adapter.mapFinishReason('length'), 'max_tokens');
    assert.equal(adapter.mapFinishReason('content-filter'), 'error');
    assert.equal(adapter.mapFinishReason('error'), 'error');
    assert.equal(adapter.mapFinishReason('tool-calls'), 'end_turn');
    assert.equal(adapter.mapFinishReason('provider-new-reason'), 'end_turn');
  });

  test('normalizes cache and reasoning usage variants in the adapter module', () => {
    assert.deepEqual(
      normalizeAiSdkUsage({
        promptTokens: 20,
        completionTokens: 5,
        totalTokens: 30,
        cacheReadInputTokens: 7,
        cacheCreationInputTokens: 3,
        inputTokenDetails: {
          reasoningTokens: 2,
        },
      }),
      {
        inputTokens: 20,
        outputTokens: 5,
        cachedInputTokens: 7,
        cacheWriteInputTokens: 3,
        reasoningTokens: 2,
        totalTokens: 30,
      },
    );
  });
});

function newAdapter(): ModelAdapter {
  return new ModelAdapter({
    connection: {
      slug: 'anthropic-main',
      name: 'Anthropic',
      providerType: 'anthropic',
      defaultModel: 'claude-sonnet-4-5-20250929',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    },
    apiKey: 'sk-test',
    modelId: 'claude-sonnet-4-5-20250929',
    modelFactory: () => ({}),
    maxSteps: 50,
    newId: idGenerator(),
    now: monotonicClock(),
  });
}

function idGenerator(): () => string {
  let index = 0;
  return () => `id-${++index}`;
}

function monotonicClock(): () => number {
  let value = 1_000;
  return () => ++value;
}
