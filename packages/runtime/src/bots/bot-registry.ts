import { EventEmitter } from 'node:events';
import type { BotChannelSettings, BotChatSettings, BotProvider } from '@maka/core';
import { generalizedErrorMessage } from '@maka/core/redaction';
import { BOT_PROVIDERS } from '@maka/core/settings';
import { SimpleBotBridge } from './simple-bridge.js';
import type { BotBridge, BotIncomingMessage, BotPlatform, BotStatus } from './types.js';

export interface BotRegistryDeps {
  onIncomingMessage: (message: BotIncomingMessage) => void;
  onStatusChange: (status: BotStatus) => void;
}

export class BotRegistry extends EventEmitter {
  private bridges = new Map<BotPlatform, BotBridge>();
  private applyQueue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: BotRegistryDeps) {
    super();
  }

  async applySettings(settings: BotChatSettings): Promise<void> {
    const next = this.applyQueue.then(
      () => this.applySettingsNow(settings),
      () => this.applySettingsNow(settings),
    );
    this.applyQueue = next.catch(() => {});
    return next;
  }

  getStatus(platform: BotPlatform): BotStatus {
    return this.bridges.get(platform)?.getStatus() ?? {
      platform,
      running: false,
      reason: platform === 'wechat' || platform === 'wecom' || platform === 'dingtalk' || platform === 'qq'
        ? 'unimplemented'
        : 'disabled',
      connection: 'none',
    };
  }

  allStatuses(): Record<BotProvider, BotStatus> {
    return Object.fromEntries(BOT_PROVIDERS.map((provider) => [provider, this.getStatus(provider)])) as Record<BotProvider, BotStatus>;
  }

  async stopAll(): Promise<void> {
    const next = this.applyQueue.then(
      () => this.stopAllNow(),
      () => this.stopAllNow(),
    );
    this.applyQueue = next.catch(() => {});
    return next;
  }

  private async applySettingsNow(settings: BotChatSettings): Promise<void> {
    await Promise.all(BOT_PROVIDERS.map((provider) => this.reconcileOne(provider, settings.channels[provider])));
  }

  private async stopAllNow(): Promise<void> {
    await Promise.all([...this.bridges.values()].map((bridge) => bridge.stop().catch(() => {})));
    this.bridges.clear();
  }

  private async reconcileOne(platform: BotPlatform, settings: BotChannelSettings): Promise<void> {
    const existing = this.bridges.get(platform);
    if (!settings.enabled) {
      if (existing) {
        await existing.stop().catch(() => {});
        this.bridges.delete(platform);
      }
      this.deps.onStatusChange(this.getStatus(platform));
      return;
    }

    if (!isImplemented(platform)) {
      this.deps.onStatusChange(this.getStatus(platform));
      return;
    }

    if (existing) {
      const update = (existing as { updateSettings?: (next: BotChannelSettings) => { needsRestart: boolean } }).updateSettings;
      if (update && !update.call(existing, settings).needsRestart) return;
      await existing.stop().catch(() => {});
    }

    const bridge = new SimpleBotBridge(platform, settings);
    this.wire(bridge);
    this.bridges.set(platform, bridge);
    await bridge.start().catch((error) => console.error(`[BotRegistry] ${platform} start failed: ${generalizedErrorMessage(error)}`));
  }

  private wire(bridge: BotBridge): void {
    const emitter = bridge as BotBridge & EventEmitter;
    emitter.on('message', (message: BotIncomingMessage) => this.deps.onIncomingMessage(message));
    emitter.on('statusChange', (status: BotStatus) => this.deps.onStatusChange(status));
  }
}

function isImplemented(platform: BotPlatform): boolean {
  return platform === 'telegram' || platform === 'discord' || platform === 'feishu';
}
