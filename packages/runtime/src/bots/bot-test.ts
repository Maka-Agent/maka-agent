import type { BotChannelSettings, BotProvider } from '@maka/core';
import type { BotTestResult } from './types.js';
import { proxiedFetch } from './proxied-fetch.js';

export async function testBotChannel(provider: BotProvider, channel: BotChannelSettings): Promise<BotTestResult> {
  if (!channel.token.trim() && provider !== 'wechat') {
    return { ok: false, error: 'Bot token is required' };
  }
  switch (provider) {
    case 'telegram': return testTelegram(channel);
    case 'discord': return testDiscord(channel);
    case 'feishu': return testFeishu(channel);
    case 'wechat':
    case 'wecom':
    case 'dingtalk':
    case 'qq':
      return {
        ok: false,
        error: `${provider} bridge is not implemented yet`,
        hint: '入口已保留，等待官方/合规接入方案确认后启用。',
      };
  }
}

async function testTelegram(channel: BotChannelSettings): Promise<BotTestResult> {
  const base = `https://api.telegram.org/bot${channel.token}`;
  try {
    const me = await (await proxiedFetch(`${base}/getMe`, { method: 'GET' })).json();
    if (!me.ok) return { ok: false, error: me.description ?? 'Invalid bot token' };
    return {
      ok: true,
      identity: { id: String(me.result.id), username: me.result.username, displayName: me.result.first_name },
      messageSent: false,
      hint: '发送 /start 给机器人后可在运行态接收消息。',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function testDiscord(channel: BotChannelSettings): Promise<BotTestResult> {
  try {
    const response = await proxiedFetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: { Authorization: `Bot ${channel.token}` },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: json.message ?? `HTTP ${response.status}` };
    return { ok: true, identity: { id: json.id, username: json.username, displayName: json.global_name } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function testFeishu(channel: BotChannelSettings): Promise<BotTestResult> {
  const appId = channel.appId ?? '';
  const appSecret = channel.appSecret || channel.token;
  if (!appId || !appSecret) return { ok: false, error: 'Feishu appId and appSecret are required' };
  try {
    const response = await proxiedFetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const json = await response.json();
    if (json.code !== 0 || !json.tenant_access_token) {
      return { ok: false, error: json.msg ?? 'Failed to issue tenant_access_token' };
    }
    return {
      ok: true,
      identity: { id: appId, username: appId, displayName: appId },
      capabilities: { auth: true },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
