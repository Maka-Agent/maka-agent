import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

async function readRepo(path: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, path), 'utf8');
}

describe('Bot incoming idempotency contract (PR-BOT-INCOMING-IDEMPOTENCY-0)', () => {
  it('dedupes platform source message ids before ack/session/send side effects', async () => {
    const main = await readRepo('apps/desktop/src/main/main.ts');
    const handler = main.match(/async function handleBotIncomingMessage\([^)]*\): Promise<void> \{[\s\S]*?const text = message\.text\.trim\(\);/);

    assert.ok(handler, 'handleBotIncomingMessage block must exist');
    assert.match(handler![0], /if \(rememberBotSourceEvent\(message\)\) return;/);
    assert.ok(
      handler![0].indexOf('rememberBotSourceEvent(message)') < handler![0].indexOf('message.text.trim()'),
      'dedupe must run before non-text ack or session/send side effects',
    );
  });

  it('bounds the in-memory dedupe set and keys it through the core helper', async () => {
    const main = await readRepo('apps/desktop/src/main/main.ts');

    assert.match(main, /botSourceEventKey\(message\)/, 'main must use the shared core source-event key helper');
    assert.match(main, /const BOT_RECENT_SOURCE_EVENT_LIMIT = 1_000;/, 'dedupe set must stay bounded');
    assert.match(main, /while \(botRecentSourceEventKeys\.size > BOT_RECENT_SOURCE_EVENT_LIMIT\)/, 'dedupe set must evict old entries');
  });
});
