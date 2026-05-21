/**
 * Tests for `@maka/ui` materializeTurns — the read-only projection from
 * StoredMessage[] into ordered turn view-models (per kenji UI-04).
 *
 * Lives in the desktop workspace because that's where node:test is
 * already wired; the subject under test is the renderer-facing helper.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { materializeTurns } from '@maka/ui';
import type { StoredMessage } from '@maka/core';

function userMsg(turnId: string, ts: number, text: string, id?: string): StoredMessage {
  return { type: 'user', id: id ?? `u-${turnId}`, turnId, ts, text };
}

function assistantMsg(turnId: string, ts: number, text: string, modelId = 'm', id?: string): StoredMessage {
  return { type: 'assistant', id: id ?? `a-${turnId}`, turnId, ts, text, modelId };
}

function toolCallMsg(turnId: string, ts: number, id: string, toolName = 'Bash'): StoredMessage {
  return { type: 'tool_call', id, turnId, ts, toolName, args: {} };
}

function toolResultMsg(turnId: string, ts: number, toolUseId: string, isError = false): StoredMessage {
  return {
    type: 'tool_result',
    id: `r-${toolUseId}`,
    turnId,
    ts,
    toolUseId,
    isError,
    content: { kind: 'text', text: 'ok' },
  };
}

describe('materializeTurns', () => {
  it('groups one full turn into user → tools → assistant', () => {
    const turns = materializeTurns([
      userMsg('t1', 100, 'hello'),
      toolCallMsg('t1', 101, 'call-1', 'Read'),
      toolResultMsg('t1', 102, 'call-1'),
      assistantMsg('t1', 103, 'hi'),
    ]);
    assert.equal(turns.length, 1);
    const [turn] = turns;
    assert.ok(turn);
    assert.equal(turn.turnId, 't1');
    assert.equal(turn.user?.text, 'hello');
    assert.equal(turn.assistant?.text, 'hi');
    assert.equal(turn.tools.length, 1);
    assert.equal(turn.tools[0]?.toolName, 'Read');
    assert.equal(turn.tools[0]?.status, 'completed');
  });

  it('preserves turn order across multiple turns and isolates tools', () => {
    const turns = materializeTurns([
      userMsg('t1', 100, 'q1'),
      toolCallMsg('t1', 101, 'c1'),
      toolResultMsg('t1', 102, 'c1'),
      assistantMsg('t1', 103, 'a1'),
      userMsg('t2', 200, 'q2'),
      toolCallMsg('t2', 201, 'c2'),
      toolResultMsg('t2', 202, 'c2'),
      assistantMsg('t2', 203, 'a2'),
    ]);
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.turnId, 't1');
    assert.equal(turns[1]?.turnId, 't2');
    // Tool from turn 1 must not leak into turn 2 (the core regression we'd
    // catch if turn grouping ever fell back to a global tools panel).
    assert.equal(turns[0]?.tools.length, 1);
    assert.equal(turns[1]?.tools.length, 1);
    assert.equal(turns[0]?.tools[0]?.toolUseId, 'c1');
    assert.equal(turns[1]?.tools[0]?.toolUseId, 'c2');
  });

  it('marks an unmatched tool_call as interrupted within its turn', () => {
    const turns = materializeTurns([
      userMsg('t1', 100, 'q'),
      // tool_call without a matching tool_result — turn was abandoned mid-run.
      toolCallMsg('t1', 101, 'c-abort'),
    ]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.tools[0]?.status, 'interrupted');
  });

  it('routes live in-flight tools into the latest turn when no matching tool_call is persisted', () => {
    // Scenario: user sent a message, server hasn't persisted the tool_call
    // yet, but a live event stream surfaced a "running" tool. It should
    // land inside the active turn, not float at the bottom.
    const turns = materializeTurns(
      [userMsg('t1', 100, 'q'), assistantMsg('t1', 999, 'placeholder')],
      [
        {
          toolUseId: 'live-1',
          toolName: 'Bash',
          status: 'running',
          args: { command: 'pwd' },
        },
      ],
    );
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.tools.length, 1);
    assert.equal(turns[0]?.tools[0]?.toolUseId, 'live-1');
    assert.equal(turns[0]?.tools[0]?.status, 'running');
  });

  it('falls back to __loose for messages without a turnId', () => {
    const turns = materializeTurns([
      // Legacy / fake-backend message: missing turnId at the type level
      // through an explicit cast, since real persisted messages always
      // carry one but defensive code paths must still render.
      { type: 'user', id: 'u-legacy', text: 'pre-turnId era', ts: 50 } as unknown as StoredMessage,
    ]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.turnId, '__loose');
    assert.equal(turns[0]?.user?.text, 'pre-turnId era');
  });

  it('merges live tool over persisted tool keeping the latest status', () => {
    // Persisted shows completed (server thinks it ended); live event says
    // it's actually still running. UI should prefer the live status so a
    // late-completing tool doesn't show stale "completed" while the user
    // is still seeing the in-flight spinner elsewhere.
    const turns = materializeTurns(
      [
        userMsg('t1', 100, 'q'),
        toolCallMsg('t1', 101, 'c1'),
        toolResultMsg('t1', 102, 'c1'),
      ],
      [
        {
          toolUseId: 'c1',
          toolName: 'Bash',
          status: 'running',
          args: {},
        },
      ],
    );
    assert.equal(turns[0]?.tools.length, 1);
    assert.equal(turns[0]?.tools[0]?.status, 'running');
  });
});
