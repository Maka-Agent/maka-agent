import { EventEmitter } from 'node:events';
import type { BotChannelSettings } from '@maka/core';
import { generalizedErrorMessage } from '@maka/core/redaction';
import type { BotBridge, BotPlatform, BotStatus, SendCapable } from './types.js';
import { proxiedFetch } from './proxied-fetch.js';

const TELEGRAM_POLL_TIMEOUT_S = 15;
const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

export class SimpleBotBridge extends EventEmitter implements BotBridge, SendCapable {
  readonly platform: BotPlatform;
  private running = false;
  private startedAt?: number;
  private lastEventAt?: number;
  private reason?: string;
  private identity: BotStatus['identity'];
  private abortController: AbortController | null = null;
  private offset = 0;

  constructor(
    platform: BotPlatform,
    private settings: BotChannelSettings,
  ) {
    super();
    this.platform = platform;
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): BotStatus {
    return {
      platform: this.platform,
      running: this.running,
      reason: this.reason,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      connection: this.connectionKind(),
      identity: this.identity,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.settings.enabled) {
      this.reason = 'disabled';
      return;
    }
    if (!this.settings.token.trim()) {
      this.reason = 'no-token';
      return;
    }

    if (this.platform === 'telegram') {
      await this.startTelegram();
      return;
    }

    if (this.platform === 'discord' || this.platform === 'feishu') {
      this.running = true;
      this.startedAt = Date.now();
      this.reason = 'ready';
      this.emit('statusChange', this.getStatus());
      return;
    }

    this.reason = 'unimplemented';
    this.emit('statusChange', this.getStatus());
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    this.reason = 'stopped';
    this.emit('statusChange', this.getStatus());
  }

  async sendMessage(chatId: string, text: string): Promise<string | null> {
    if (this.platform !== 'telegram' || !this.running) return null;
    const response = await telegramApi(this.settings.token, 'sendMessage', { chat_id: chatId, text });
    return response.ok ? String(response.result?.message_id ?? '') || null : null;
  }

  updateSettings(settings: BotChannelSettings): { needsRestart: boolean } {
    const needsRestart = settings.enabled !== this.settings.enabled || settings.token !== this.settings.token;
    this.settings = settings;
    return { needsRestart };
  }

  private async startTelegram(): Promise<void> {
    try {
      const me = await telegramApi(this.settings.token, 'getMe');
      if (!me.ok) {
        this.reason = me.description ?? 'get-me-failed';
        this.emit('statusChange', this.getStatus());
        return;
      }
      this.identity = {
        id: String(me.result?.id ?? ''),
        username: me.result?.username,
        displayName: me.result?.first_name,
      };
      this.running = true;
      this.startedAt = Date.now();
      this.reason = undefined;
      this.emit('statusChange', this.getStatus());
      void this.pollTelegram();
    } catch (error) {
      this.reason = generalizedErrorMessage(error);
      this.emit('statusChange', this.getStatus());
    }
  }

  private async pollTelegram(): Promise<void> {
    while (this.running) {
      this.abortController = new AbortController();
      try {
        const updates = await telegramApi(
          this.settings.token,
          'getUpdates',
          {
            offset: this.offset,
            timeout: TELEGRAM_POLL_TIMEOUT_S,
            allowed_updates: ['message'],
          },
          this.abortController.signal,
        );
        if (!updates.ok || !Array.isArray(updates.result)) {
          await sleep(5_000);
          continue;
        }
        for (const update of updates.result) {
          this.offset = Number(update.update_id ?? this.offset) + 1;
          this.handleTelegramMessage(update.message);
        }
      } catch (error) {
        if (!this.running) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        await sleep(5_000);
      }
    }
  }

  private handleTelegramMessage(message: any): void {
    if (!message?.from) return;
    this.lastEventAt = Date.now();
    this.emit('message', {
      platform: 'telegram',
      userId: String(message.from.id),
      userName: message.from.username ?? message.from.first_name ?? String(message.from.id),
      chatId: String(message.chat?.id ?? ''),
      isGroup: message.chat?.type === 'group' || message.chat?.type === 'supergroup',
      text: message.text ?? message.caption ?? '',
      sourceMessageId: String(message.message_id ?? ''),
      receivedAt: this.lastEventAt,
    });
    this.emit('statusChange', this.getStatus());
  }

  private connectionKind(): BotStatus['connection'] {
    if (this.platform === 'telegram') return 'polling';
    if (this.platform === 'discord' || this.platform === 'feishu') return 'gateway';
    return 'none';
  }
}

async function telegramApi(token: string, method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const timeoutMs = typeof body?.timeout === 'number'
    ? (body.timeout + 5) * 1_000
    : TELEGRAM_REQUEST_TIMEOUT_MS;
  const response = await proxiedFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    timeoutMs,
  });
  return response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
