import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createDefaultBotChannel, type BotProvider } from '@maka/core';
import { testBotChannel } from '../bot-test.js';

describe('testBotChannel copy', () => {
  test('planned providers return product-facing unavailable copy', async () => {
    // PR-BOT-WECOM-CREDENTIALS-TEST-0 + PR-BOT-DINGTALK-CREDENTIALS-TEST-0:
    // both now have real credential tests. The remaining planned
    // platforms are wechat (个人号 合规复杂) and qq.
    const providers: BotProvider[] = ['wechat', 'qq'];

    for (const provider of providers) {
      const result = await testBotChannel(provider, {
        ...createDefaultBotChannel(provider),
        token: 'placeholder-token',
      });

      assert.equal(result.ok, false);
      assert.match(result.error ?? '', /当前不支持凭据测试/);
      assert.match(result.hint ?? '', /不会进入可用机器人列表或计划提醒投递目标/);
      assert.doesNotMatch(`${result.error ?? ''} ${result.hint ?? ''}`, /bridge|not implemented|scaffold|未实现|接入方案/i);
    }
  });

  test('wecom rejects empty credentials with product copy (not a generic "Bot token required")', async () => {
    const result = await testBotChannel('wecom', createDefaultBotChannel('wecom'));
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /corp_id/);
    assert.match(result.error ?? '', /corp_secret/);
  });

  test('dingtalk rejects empty credentials with product copy (not a generic "Bot token required")', async () => {
    const result = await testBotChannel('dingtalk', createDefaultBotChannel('dingtalk'));
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /appkey/);
    assert.match(result.error ?? '', /appsecret/);
  });
});
