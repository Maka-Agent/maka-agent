import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { __TEST__ } from '../simple-bridge.js';

const { classifyTelegramSendResponse, TELEGRAM_RETRY_MIN_MS, TELEGRAM_RETRY_MAX_MS } = __TEST__;

describe('classifyTelegramSendResponse (PR-BOT-RATELIMIT-RETRY-0)', () => {
  it('returns ok with the message id on a successful response', () => {
    const result = classifyTelegramSendResponse({
      ok: true,
      result: { message_id: 12345 },
    });
    assert.deepEqual(result, { kind: 'ok', messageId: '12345' });
  });

  it('returns ok with null id when the success response has no message_id', () => {
    const result = classifyTelegramSendResponse({ ok: true, result: {} });
    assert.deepEqual(result, { kind: 'ok', messageId: null });
  });

  it('returns retry with the Telegram-provided backoff on 429', () => {
    const result = classifyTelegramSendResponse({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests: retry after 5',
      parameters: { retry_after: 5 },
    });
    assert.equal(result.kind, 'retry');
    if (result.kind === 'retry') {
      assert.equal(result.delayMs, 5_000);
    }
  });

  it('floors the retry delay at the minimum even when Telegram reports 0', () => {
    const result = classifyTelegramSendResponse({
      ok: false,
      error_code: 429,
      parameters: { retry_after: 0 },
    });
    assert.equal(result.kind, 'retry');
    if (result.kind === 'retry') {
      assert.equal(result.delayMs, TELEGRAM_RETRY_MIN_MS);
    }
  });

  it('caps the retry delay at the maximum so an inflated retry_after cannot stall the bridge', () => {
    const result = classifyTelegramSendResponse({
      ok: false,
      error_code: 429,
      parameters: { retry_after: 3600 }, // 1 hour
    });
    assert.equal(result.kind, 'retry');
    if (result.kind === 'retry') {
      assert.equal(result.delayMs, TELEGRAM_RETRY_MAX_MS);
    }
  });

  it('returns fatal for permanent 4xx errors', () => {
    const result = classifyTelegramSendResponse({
      ok: false,
      error_code: 400,
      description: 'Bad Request: chat not found',
    });
    assert.deepEqual(result, { kind: 'fatal', description: 'Bad Request: chat not found' });
  });

  it('returns fatal for 5xx so the bridge does not loop on a Telegram outage', () => {
    const result = classifyTelegramSendResponse({
      ok: false,
      error_code: 502,
      description: 'Bad Gateway',
    });
    assert.deepEqual(result, { kind: 'fatal', description: 'Bad Gateway' });
  });

  it('returns fatal with a stable description when the response shape is unexpected', () => {
    const result = classifyTelegramSendResponse(null);
    assert.deepEqual(result, { kind: 'fatal', description: 'send-failed' });

    const noBody = classifyTelegramSendResponse({});
    assert.deepEqual(noBody, { kind: 'fatal', description: 'send-failed' });
  });

  it('treats a non-numeric retry_after as the floor delay', () => {
    // Defense-in-depth: malformed parameters payload should not crash.
    const result = classifyTelegramSendResponse({
      ok: false,
      error_code: 429,
      parameters: { retry_after: 'wat' },
    });
    assert.equal(result.kind, 'retry');
    if (result.kind === 'retry') {
      assert.equal(result.delayMs, TELEGRAM_RETRY_MIN_MS);
    }
  });
});
