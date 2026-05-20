import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDefaultBotChannel } from '@maka/core/settings';
import type { BotChatSettings, BotProvider } from '@maka/core';
import { BotRegistry } from '../bot-registry.js';
import type { BotStatus } from '../types.js';

describe('BotRegistry', () => {
  test('reports disabled and unimplemented statuses without starting bridges', async () => {
    const statuses: BotStatus[] = [];
    const registry = new BotRegistry({
      onIncomingMessage: () => {},
      onStatusChange: (status) => statuses.push(status),
    });

    await registry.applySettings(settingsWith({
      wechat: { enabled: true, token: 'unused' },
    }));

    assert.equal(registry.getStatus('telegram').reason, 'disabled');
    assert.equal(registry.getStatus('wechat').reason, 'unimplemented');
    assert.equal(registry.getStatus('wechat').running, false);
    assert.equal(statuses.some((status) => status.platform === 'wechat' && status.reason === 'unimplemented'), true);
  });

  test('starts implemented non-network bridges and stops them when disabled', async () => {
    const statuses: BotStatus[] = [];
    const registry = new BotRegistry({
      onIncomingMessage: () => {},
      onStatusChange: (status) => statuses.push(status),
    });

    await registry.applySettings(settingsWith({
      discord: { enabled: true, token: 'discord-token' },
    }));

    assert.equal(registry.getStatus('discord').running, true);
    assert.equal(registry.getStatus('discord').reason, 'ready');

    await registry.applySettings(settingsWith({
      discord: { enabled: false, token: 'discord-token' },
    }));

    assert.equal(registry.getStatus('discord').running, false);
    assert.equal(registry.getStatus('discord').reason, 'disabled');
    assert.equal(statuses.some((status) => status.platform === 'discord' && status.reason === 'stopped'), true);
  });

  test('queues overlapping applySettings calls so the newest settings win deterministically', async () => {
    const registry = new BotRegistry({
      onIncomingMessage: () => {},
      onStatusChange: () => {},
    });

    await Promise.all([
      registry.applySettings(settingsWith({ discord: { enabled: true, token: 'old-token' } })),
      registry.applySettings(settingsWith({ discord: { enabled: false, token: 'old-token' } })),
      registry.applySettings(settingsWith({ discord: { enabled: true, token: 'new-token' } })),
    ]);

    assert.equal(registry.getStatus('discord').running, true);
    assert.equal(registry.getStatus('discord').reason, 'ready');
  });

  test('stopAll waits behind any pending applySettings call and clears bridges', async () => {
    const registry = new BotRegistry({
      onIncomingMessage: () => {},
      onStatusChange: () => {},
    });

    await Promise.all([
      registry.applySettings(settingsWith({ discord: { enabled: true, token: 'discord-token' } })),
      registry.stopAll(),
    ]);

    assert.equal(registry.getStatus('discord').running, false);
    assert.equal(registry.getStatus('discord').reason, 'disabled');
  });
});

function settingsWith(overrides: Partial<Record<BotProvider, Partial<ReturnType<typeof createDefaultBotChannel>>>>): BotChatSettings {
  const providers: BotProvider[] = ['telegram', 'feishu', 'wecom', 'wechat', 'discord', 'dingtalk', 'qq'];
  return {
    channels: Object.fromEntries(
      providers.map((provider) => [
        provider,
        {
          ...createDefaultBotChannel(provider),
          ...(overrides[provider] ?? {}),
        },
      ]),
    ) as BotChatSettings['channels'],
  };
}
