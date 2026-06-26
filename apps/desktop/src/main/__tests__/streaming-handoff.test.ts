import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatView } from '@maka/ui';
import {
  applyAssistantComplete,
  clearSettledAssistantStreamSlot,
  drainAssistantStreamSlot,
  markAssistantStreamSlotDraining,
  type AssistantStreamSlots,
} from '@maka/ui/assistant-stream';

describe('assistant streaming handoff', () => {
  it('keeps a draining assistant answer as the single visible owner before committed handoff', () => {
    const finalText = '12345678';
    const markup = renderToStaticMarkup(createElement(ChatView, {
      activeSession: {
        id: 'session-1',
        name: 'handoff',
        lastMessageAt: 1,
        status: 'active',
        backend: 'ai-sdk',
        labels: [],
        isFlagged: false,
        isArchived: false,
        hasUnread: false,
        llmConnectionSlug: 'conn',
        model: 'model',
        permissionMode: 'ask',
      },
      messages: [
        { type: 'user', id: 'user-1', turnId: 'turn-1', ts: 1, text: 'go' },
        { type: 'assistant', id: 'assistant-1', turnId: 'turn-1', ts: 2, text: finalText, modelId: 'model' },
      ],
      streamingText: finalText,
      streamingComplete: true,
      streamingMessageId: 'assistant-1',
      tools: [],
      mode: 'sessions',
      onNew() {},
    } satisfies Parameters<typeof ChatView>[0]));

    assert.match(markup, /maka-bubble-streaming/, 'draining output should remain in the streaming bubble');
    assert.equal(
      countOccurrences(markup, finalText),
      1,
      'draining output must not render both the committed message and the streaming bubble',
    );
  });

  it('text_complete replaces the live slot with the final draining text', () => {
    const current: AssistantStreamSlots = {
      'session-1': { text: 'part', truncated: true, phase: 'streaming', messageId: 'assistant-1' },
    };

    const next = drainAssistantStreamSlot(current, 'session-1', applyAssistantComplete('final answer'), 'assistant-1');

    assert.equal(next['session-1']?.text, 'final answer');
    assert.equal(next['session-1']?.truncated, false);
    assert.equal(next['session-1']?.phase, 'draining');
    assert.equal(next['session-1']?.messageId, 'assistant-1');
  });

  it('complete marks the current streamed text as draining without replacing it', () => {
    const current: AssistantStreamSlots = {
      'session-1': { text: 'delta accumulated text', truncated: false, phase: 'streaming', messageId: 'assistant-1' },
    };

    const next = markAssistantStreamSlotDraining(current, 'session-1');

    assert.equal(next['session-1']?.text, 'delta accumulated text');
    assert.equal(next['session-1']?.phase, 'draining');
    assert.equal(next['session-1']?.messageId, 'assistant-1');
  });

  it('settled slot reducer clears after refresh failure because the clear no longer depends on refresh success', () => {
    const settledSlot = { text: 'final answer', truncated: false, phase: 'draining' as const, messageId: 'assistant-1' };
    const slots: AssistantStreamSlots = {
      'session-1': settledSlot,
    };

    const next = clearSettledAssistantStreamSlot(slots, 'session-1', settledSlot, 'assistant-1');

    assert.deepEqual(next['session-1'], { text: '', truncated: false, phase: 'streaming' });
  });

  it('settled slot reducer keeps refresh-before-clear callers race-safe for a newer stream slot', () => {
    const settledSlot = { text: 'old final', truncated: false, phase: 'draining' as const, messageId: 'assistant-old' };
    const slots: AssistantStreamSlots = {
      'session-1': { text: 'new answer', truncated: false, phase: 'streaming', messageId: 'assistant-new' },
    };

    const next = clearSettledAssistantStreamSlot(slots, 'session-1', settledSlot, 'assistant-old');

    assert.equal(next, slots);
  });

  it('settled slot reducer clears a replayed equivalent draining slot after refresh', () => {
    const settledSlot = { text: 'final answer', truncated: false, phase: 'draining' as const, messageId: 'assistant-1' };
    const slots: AssistantStreamSlots = {
      'session-1': { text: 'final answer', truncated: false, phase: 'draining', messageId: 'assistant-1' },
    };

    const next = clearSettledAssistantStreamSlot(slots, 'session-1', settledSlot, 'assistant-1');

    assert.deepEqual(next['session-1'], { text: '', truncated: false, phase: 'streaming' });
  });

  it('settled slot reducer does not clear a newer stream slot that replaces the settled one during refresh', () => {
    const settledSlot = { text: 'old final', truncated: false, phase: 'draining' as const, messageId: 'assistant-old' };
    const slots: AssistantStreamSlots = {
      'session-1': { text: 'new answer', truncated: false, phase: 'streaming', messageId: 'assistant-new' },
    };

    const next = clearSettledAssistantStreamSlot(slots, 'session-1', settledSlot, 'assistant-old');

    assert.deepEqual(next['session-1'], {
      text: 'new answer',
      truncated: false,
      phase: 'streaming',
      messageId: 'assistant-new',
    });
  });

  it('settled slot reducer does not clear a replaced draining slot only because the message id still matches', () => {
    const settledSlot = { text: 'old final', truncated: false, phase: 'draining' as const, messageId: 'assistant-1' };
    const slots: AssistantStreamSlots = {
      'session-1': { text: 'replacement final', truncated: false, phase: 'draining', messageId: 'assistant-1' },
    };

    const next = clearSettledAssistantStreamSlot(slots, 'session-1', settledSlot, 'assistant-1');

    assert.deepEqual(next['session-1'], {
      text: 'replacement final',
      truncated: false,
      phase: 'draining',
      messageId: 'assistant-1',
    });
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
