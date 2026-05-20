import type { BotProvider } from '@maka/core';

export type BotPlatform = BotProvider;

export interface BotStatus {
  platform: BotPlatform;
  running: boolean;
  reason?: string;
  startedAt?: number;
  lastEventAt?: number;
  connection: 'polling' | 'gateway' | 'webhook' | 'none';
  identity?: {
    id?: string;
    username?: string;
    displayName?: string;
  };
}

export interface BotIncomingMessage {
  platform: BotPlatform;
  userId: string;
  userName: string;
  chatId: string;
  isGroup: boolean;
  text: string;
  sourceMessageId: string;
  receivedAt: number;
  attachments?: Array<{ kind: 'image' | 'file' | 'voice'; url?: string; fileId?: string; mimeType?: string }>;
}

export interface BotBridge {
  readonly platform: BotPlatform;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getStatus(): BotStatus;
}

export interface SendCapable {
  sendMessage(chatId: string, text: string): Promise<string | null>;
}

export interface BotTestResult {
  ok: boolean;
  identity?: { id: string; username?: string; displayName?: string };
  messageSent?: boolean;
  capabilities?: Record<string, boolean>;
  error?: string;
  hint?: string;
}
