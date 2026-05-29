/**
 * Tests for the onboarding service (PR110b).
 *
 * Validate the contract gates @kenji + @xuan signed off on:
 *   - getSnapshot resolves secrets in parallel (timing assertion)
 *   - credential lookup errors are NEVER thrown to caller; the slug
 *     is treated as `hasSecret: false`
 *   - setMilestone rejects invalid id / status
 *   - setMilestone never accepts a renderer-supplied timestamp
 *   - last-valid-entry-wins dedup survives via the sanitizer
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type {
  OnboardingMilestone,
  OnboardingMilestoneId,
  SessionSummary,
} from '@maka/core';
import type { LlmConnection } from '@maka/core';
import {
  createOnboardingService,
  type OnboardingServiceDeps,
} from '../onboarding-service.js';

function realConnection(overrides: Partial<LlmConnection> = {}): LlmConnection {
  return {
    slug: overrides.slug ?? 'anthropic-live',
    name: overrides.name ?? 'Anthropic Live',
    providerType: overrides.providerType ?? 'anthropic',
    defaultModel: overrides.defaultModel ?? 'claude-sonnet-4-5-20250929',
    enabled: overrides.enabled ?? true,
    models: overrides.models ?? [
      { id: 'claude-sonnet-4-5-20250929', capabilities: { vision: true, reasoning: true, functionCalling: true }, contextWindow: 200_000 },
    ],
    modelSource: 'fetched',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as LlmConnection;
}

function fakeDeps(overrides: Partial<OnboardingServiceDeps> = {}): OnboardingServiceDeps {
  const milestones: OnboardingMilestone[] = [];
  return {
    listConnections: async () => [],
    getDefaultSlug: async () => null,
    listSessions: async () => [] as SessionSummary[],
    getMilestones: async () => milestones,
    upsertMilestone: async (id, status) => {
      const timestamp = Date.now();
      const next: OnboardingMilestone =
        status === 'completed' ? { id, completedAt: timestamp } : { id, skippedAt: timestamp };
      // Dedup last-wins by id.
      const existingIdx = milestones.findIndex((m) => m.id === id);
      if (existingIdx >= 0) milestones[existingIdx] = next;
      else milestones.push(next);
      return milestones.slice();
    },
    clearMilestone: async (id) => {
      const existingIdx = milestones.findIndex((m) => m.id === id);
      if (existingIdx >= 0) milestones.splice(existingIdx, 1);
      return milestones.slice();
    },
    hasApiKey: async (_slug: string) => false,
    ...overrides,
  };
}

describe('createOnboardingService.getSnapshot', () => {
  it('returns derived OnboardingState + sanitized milestones together', async () => {
    const service = createOnboardingService(
      fakeDeps({
        listConnections: async () => [realConnection({ slug: 'a' })],
        getDefaultSlug: async () => 'a',
        hasApiKey: async (slug) => slug === 'a',
        getMilestones: async () => [{ id: 'first_chat_sent', completedAt: 1_700_000_000_000 }],
      }),
    );
    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.state.kind, 'ready_empty');
    assert.deepEqual(snapshot.milestones, [
      { id: 'first_chat_sent', completedAt: 1_700_000_000_000 },
    ]);
  });

  it('resolves per-connection secrets in PARALLEL (@kenji perf gate)', async () => {
    // Each hasApiKey call sleeps 50ms. With 4 connections, serial =
    // 200ms; parallel = ~50ms. Assert <= 150ms to leave a generous
    // buffer for slow CI machines while still catching serialization.
    const conns = ['a', 'b', 'c', 'd'].map((slug) => realConnection({ slug }));
    const service = createOnboardingService(
      fakeDeps({
        listConnections: async () => conns,
        getDefaultSlug: async () => 'a',
        hasApiKey: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return true;
        },
      }),
    );
    const start = Date.now();
    await service.getSnapshot();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 150, `secret lookups must run in parallel; took ${elapsed}ms (serial would be ~200ms)`);
  });

  it('credential-lookup error → treated as hasSecret=false, NEVER thrown to caller', async () => {
    const service = createOnboardingService(
      fakeDeps({
        listConnections: async () => [realConnection({ slug: 'broken' })],
        getDefaultSlug: async () => 'broken',
        hasApiKey: async () => {
          throw new Error('safeStorage decrypt failed');
        },
      }),
    );
    // The call must NOT reject; the missing secret routes the user to
    // `needs_connection_credentials`.
    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.state.kind, 'needs_connection_credentials');
    if (snapshot.state.kind === 'needs_connection_credentials') {
      assert.equal(snapshot.state.connectionSlug, 'broken');
    }
  });
});

describe('createOnboardingService.clearMilestone — strict validation', () => {
  it('rejects invalid milestone id (closed enum)', async () => {
    const service = createOnboardingService(fakeDeps());
    await assert.rejects(
      () => service.clearMilestone('not_a_real_milestone'),
      /INVALID_MILESTONE_ID/,
    );
  });

  it('clears one milestone and returns a fresh snapshot', async () => {
    let stored: OnboardingMilestone[] = [
      { id: 'first_chat_sent', completedAt: 1 },
      { id: 'first_run_suggestion_workspace_map', skippedAt: 2 },
    ];
    const service = createOnboardingService(
      fakeDeps({
        listConnections: async () => [realConnection({ slug: 'a' })],
        getDefaultSlug: async () => 'a',
        hasApiKey: async () => true,
        getMilestones: async () => stored,
        clearMilestone: async (id) => {
          stored = stored.filter((entry) => entry.id !== id);
          return stored;
        },
      }),
    );

    const snapshot = await service.clearMilestone('first_run_suggestion_workspace_map');

    assert.equal(snapshot.state.kind, 'ready_empty');
    assert.deepEqual(snapshot.milestones, [{ id: 'first_chat_sent', completedAt: 1 }]);
  });
});

describe('createOnboardingService.setMilestone — strict validation', () => {
  it('rejects invalid milestone id (closed enum)', async () => {
    const service = createOnboardingService(fakeDeps());
    await assert.rejects(
      () => service.setMilestone('not_a_real_milestone', 'completed'),
      /INVALID_MILESTONE_ID/,
    );
  });

  it('rejects invalid id type (not a string)', async () => {
    const service = createOnboardingService(fakeDeps());
    for (const bad of [null, undefined, 1, true, {}, [], Symbol('x')]) {
      await assert.rejects(
        () => service.setMilestone(bad as unknown, 'completed'),
        /INVALID_MILESTONE_ID/,
        `should reject id=${String(bad)}`,
      );
    }
  });

  it('rejects invalid status (only "completed" | "skipped")', async () => {
    const service = createOnboardingService(fakeDeps());
    for (const bad of ['unknown', '', 'pending', 'done', null, undefined, 1, true]) {
      await assert.rejects(
        () => service.setMilestone('first_chat_sent', bad as unknown),
        /INVALID_MILESTONE_STATUS/,
        `should reject status=${String(bad)}`,
      );
    }
  });

  it('accepts valid input and produces fresh snapshot', async () => {
    let stored: OnboardingMilestone[] = [];
    const service = createOnboardingService(
      fakeDeps({
        listConnections: async () => [realConnection({ slug: 'a' })],
        getDefaultSlug: async () => 'a',
        hasApiKey: async () => true,
        getMilestones: async () => stored,
        upsertMilestone: async (id, status) => {
          stored = [
            ...stored.filter((m) => m.id !== id),
            status === 'completed' ? { id, completedAt: 1_700_000_000_000 } : { id, skippedAt: 1_700_000_000_000 },
          ];
          return stored;
        },
      }),
    );
    const snapshot = await service.setMilestone('first_chat_sent', 'completed');
    assert.equal(snapshot.milestones.length, 1);
    assert.equal(snapshot.milestones[0]?.id, 'first_chat_sent');
    assert.ok(snapshot.milestones[0]?.completedAt);
    // State re-derived after milestone write.
    assert.equal(snapshot.state.kind, 'ready_empty');
  });

  it('never accepts a renderer-supplied timestamp (signature is id+status only)', async () => {
    // The IPC bridge type only passes (id, status). Even if a caller
    // crafts a third argument, setMilestone ignores it; the timestamp
    // comes from the underlying store (Date.now()). Verify by passing
    // a tampered third arg and confirming the service ignores it.
    let receivedArgs: unknown[] = [];
    const service = createOnboardingService(
      fakeDeps({
        upsertMilestone: async (id, status, ...rest) => {
          // Capture all args the service forwarded.
          receivedArgs = [id, status, ...rest];
          return [{ id, completedAt: Date.now() }];
        },
      }),
    );
    // Cast to invoke with a tampered third arg.
    await (service.setMilestone as unknown as (
      id: OnboardingMilestoneId,
      status: 'completed' | 'skipped',
      tampered: number,
    ) => Promise<unknown>)('first_chat_sent', 'completed', 99);
    assert.equal(
      receivedArgs.length,
      2,
      'setMilestone must forward only (id, status); never a renderer timestamp',
    );
  });
});
