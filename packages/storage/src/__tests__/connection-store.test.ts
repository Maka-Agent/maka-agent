import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createConnectionStore } from '../connection-store.js';

describe('FileConnectionStore', () => {
  test('persists explicit connection test status updates', async () => {
    await withConnectionStore(async (store) => {
      const created = await store.create({
        slug: 'anthropic-main',
        name: 'Claude',
        providerType: 'anthropic',
        defaultModel: 'claude-sonnet-4-5-20250929',
      });

      await store.update(created.slug, {
        lastTestStatus: 'verified',
        lastTestAt: '2026-05-21T09:00:00.000Z',
        lastTestMessage: 'Connection verified',
      });

      const next = await store.get(created.slug);
      assert.equal(next?.lastTestStatus, 'verified');
      assert.equal(next?.lastTestAt, '2026-05-21T09:00:00.000Z');
      assert.equal(next?.lastTestMessage, 'Connection verified');
    });
  });

  test('invalidates old verified status when configuration changes', async () => {
    await withConnectionStore(async (store) => {
      const created = await store.create({
        slug: 'openai-main',
        name: 'OpenAI',
        providerType: 'openai',
        defaultModel: 'gpt-4o-mini',
      });
      await store.update(created.slug, {
        lastTestStatus: 'verified',
        lastTestAt: '2026-05-21T09:00:00.000Z',
        lastTestMessage: 'Connection verified',
      });

      await store.update(created.slug, { defaultModel: 'gpt-5' });
      let next = await store.get(created.slug);
      assert.equal(next?.lastTestStatus, undefined);
      assert.equal(next?.lastTestAt, undefined);
      assert.equal(next?.lastTestMessage, undefined);

      await store.update(created.slug, {
        lastTestStatus: 'verified',
        lastTestAt: '2026-05-21T10:00:00.000Z',
        lastTestMessage: 'Connection verified',
      });
      await store.update(created.slug, { apiKey: 'new-secret' });
      next = await store.get(created.slug);
      assert.equal(next?.lastTestStatus, undefined);
    });
  });

  test('non-configuration updates do not erase last test status', async () => {
    await withConnectionStore(async (store) => {
      const created = await store.create({
        slug: 'ollama-local',
        name: 'Ollama',
        providerType: 'ollama',
        defaultModel: 'llama3.2',
      });
      await store.update(created.slug, {
        lastTestStatus: 'verified',
        lastTestAt: '2026-05-21T09:00:00.000Z',
        lastTestMessage: 'Connection verified',
      });

      await store.update(created.slug, { enabled: false, name: 'Ollama Disabled' });

      const next = await store.get(created.slug);
      assert.equal(next?.enabled, false);
      assert.equal(next?.lastTestStatus, 'verified');
    });
  });

  test('persists successful model discovery metadata', async () => {
    await withConnectionStore(async (store) => {
      const created = await store.create({
        slug: 'zai-main',
        name: 'Z.ai',
        providerType: 'zai-coding-plan',
        defaultModel: 'glm-4.7',
      });

      await store.update(created.slug, {
        models: [{ id: 'glm-5' }, { id: 'glm-5.1' }],
        modelSource: 'fetched',
        modelsFetchedAt: 1_800_000_000_000,
      });

      const next = await store.get(created.slug);
      assert.deepEqual(next?.models, [{ id: 'glm-5' }, { id: 'glm-5.1' }]);
      assert.equal(next?.modelSource, 'fetched');
      assert.equal(next?.modelsFetchedAt, 1_800_000_000_000);
    });
  });

  test('invalidates model cache metadata when credentials or base URL change', async () => {
    await withConnectionStore(async (store) => {
      const created = await store.create({
        slug: 'zai-main',
        name: 'Z.ai',
        providerType: 'zai-coding-plan',
        defaultModel: 'glm-4.7',
      });
      await store.update(created.slug, {
        models: [{ id: 'glm-5' }],
        modelSource: 'fetched',
        modelsFetchedAt: 1_800_000_000_000,
      });

      await store.update(created.slug, { apiKey: 'new-secret' });
      let next = await store.get(created.slug);
      assert.equal(next?.models, undefined);
      assert.equal(next?.modelSource, undefined);
      assert.equal(next?.modelsFetchedAt, undefined);

      await store.update(created.slug, {
        models: [{ id: 'glm-5.1' }],
        modelSource: 'fetched',
        modelsFetchedAt: 1_800_000_000_001,
      });
      await store.update(created.slug, { baseUrl: 'https://api.z.ai/api/coding/paas/v4' });
      next = await store.get(created.slug);
      assert.equal(next?.models, undefined);
      assert.equal(next?.modelSource, undefined);
      assert.equal(next?.modelsFetchedAt, undefined);
    });
  });

  test('keeps model cache metadata for display-only and default-model updates', async () => {
    await withConnectionStore(async (store) => {
      const created = await store.create({
        slug: 'openai-main',
        name: 'OpenAI',
        providerType: 'openai',
        defaultModel: 'gpt-4o-mini',
      });
      await store.update(created.slug, {
        models: [{ id: 'gpt-4o-mini' }, { id: 'gpt-5' }],
        modelSource: 'fetched',
        modelsFetchedAt: 1_800_000_000_000,
      });

      await store.update(created.slug, {
        name: 'OpenAI Primary',
        enabled: false,
        defaultModel: 'gpt-5',
      });

      const next = await store.get(created.slug);
      assert.deepEqual(next?.models, [{ id: 'gpt-4o-mini' }, { id: 'gpt-5' }]);
      assert.equal(next?.modelSource, 'fetched');
      assert.equal(next?.modelsFetchedAt, 1_800_000_000_000);
    });
  });
});

async function withConnectionStore<T>(fn: (store: ReturnType<typeof createConnectionStore>) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'maka-connection-store-'));
  try {
    return await fn(createConnectionStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
