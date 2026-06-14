import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRunStore } from '../agent-run-store.js';
import type { AgentRunEvent, AgentRunHeader } from '@maka/core';

describe('AgentRunStore', () => {
  it('creates, reads, updates, and lists runs under a session', async () => {
    await withStore(async (store, root) => {
      const first = makeHeader({ runId: 'run-1', createdAt: 1, updatedAt: 1 });
      const second = makeHeader({ runId: 'run-2', turnId: 'turn-2', createdAt: 2, updatedAt: 2 });

      await store.createRun(second);
      await store.createRun(first);
      await store.updateRun('session-1', 'run-1', {
        status: 'completed',
        completedAt: 10,
        updatedAt: 10,
      });

      const read = await store.readRun('session-1', 'run-1');
      assert.equal(read.status, 'completed');
      assert.equal(read.completedAt, 10);
      assert.deepEqual((await store.listSessionRuns('session-1')).map((run) => run.runId), ['run-1', 'run-2']);
      assert.equal(
        JSON.parse(await readFile(join(root, 'sessions', 'session-1', 'runs', 'run-1', 'run.json'), 'utf8')).runId,
        'run-1',
      );
    });
  });

  it('serializes same-run event appends', async () => {
    await withStore(async (store) => {
      await store.createRun(makeHeader());

      await Promise.all(Array.from({ length: 20 }, (_, index) =>
        store.appendEvent('session-1', 'run-1', makeEvent({ id: `event-${index}`, ts: index })),
      ));

      const events = await store.readEvents('session-1', 'run-1');
      assert.equal(events.length, 20);
      assert.equal(new Set(events.map((event) => event.id)).size, 20);
    });
  });

  it('recovers corrupt event lines without hiding later events', async () => {
    await withStore(async (store, root) => {
      await store.createRun(makeHeader());
      await store.appendEvent('session-1', 'run-1', makeEvent({ id: 'good-1', ts: 1 }));
      const eventsPath = join(root, 'sessions', 'session-1', 'runs', 'run-1', 'events.jsonl');
      await writeFile(eventsPath, '{"type":"run_started"\n' + JSON.stringify(makeEvent({ id: 'good-2', ts: 2 })) + '\n', {
        flag: 'a',
      });

      const events = await store.readEvents('session-1', 'run-1');
      assert.equal(events[0]?.id, 'good-1');
      assert.equal(events[1]?.type, 'event_corrupt');
      assert.equal(events[2]?.id, 'good-2');
    });
  });

  it('drops an unterminated corrupt tail event', async () => {
    await withStore(async (store, root) => {
      await store.createRun(makeHeader());
      const eventsPath = join(root, 'sessions', 'session-1', 'runs', 'run-1', 'events.jsonl');
      await mkdir(join(root, 'sessions', 'session-1', 'runs', 'run-1'), { recursive: true });
      await writeFile(eventsPath, JSON.stringify(makeEvent({ id: 'good-1', ts: 1 })) + '\n{"type":"run_started"');

      const events = await store.readEvents('session-1', 'run-1');
      assert.deepEqual(events.map((event) => event.id), ['good-1']);
    });
  });

  it('keeps newline-terminated corrupt tail events as durable corruption notes', async () => {
    await withStore(async (store, root) => {
      await store.createRun(makeHeader());
      const eventsPath = join(root, 'sessions', 'session-1', 'runs', 'run-1', 'events.jsonl');
      await mkdir(join(root, 'sessions', 'session-1', 'runs', 'run-1'), { recursive: true });
      await writeFile(eventsPath, JSON.stringify(makeEvent({ id: 'good-1', ts: 1 })) + '\n{"type":"run_started"\n');

      const events = await store.readEvents('session-1', 'run-1');
      assert.deepEqual(events.map((event) => event.type), ['run_started', 'event_corrupt']);
      assert.equal(events[1]?.data?.lineNumber, 2);
    });
  });
});

async function withStore(fn: (store: ReturnType<typeof createAgentRunStore>, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'maka-agent-run-store-'));
  try {
    await fn(createAgentRunStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function makeHeader(overrides: Partial<AgentRunHeader> = {}): AgentRunHeader {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    status: 'created',
    backendKind: 'fake',
    llmConnectionSlug: 'fake',
    modelId: 'fake-model',
    cwd: '/tmp/cwd',
    permissionMode: 'ask',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return {
    type: 'run_started',
    id: 'event-1',
    runId: 'run-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    ts: 1,
    ...overrides,
  };
}
