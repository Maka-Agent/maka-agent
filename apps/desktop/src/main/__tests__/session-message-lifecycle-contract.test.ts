/**
 * Source contract for active-session message lifecycle.
 *
 * The chat body must not show messages from the previous session while the
 * newly selected session's message read is still in flight. Once a session is
 * already active, transient refresh failures must preserve the visible log
 * instead of blanking the conversation.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const MAIN_RENDERER_SOURCE = join(process.cwd(), 'src', 'renderer', 'main.tsx');

describe('active session message lifecycle contract', () => {
  it('clears stale messages before reading the selected session and guards late reads', async () => {
    const src = await readFile(MAIN_RENDERER_SOURCE, 'utf8');
    const ui = await readFile(join(process.cwd(), '..', '..', 'packages', 'ui', 'src', 'components.tsx'), 'utf8');
    const activeSessionEffect = src.match(/useEffect\(\(\) => \{\s*if \(!activeId\) return;[\s\S]*?readMessages\(activeId\)[\s\S]*?\}, \[activeId\]\);/)?.[0] ?? '';
    const activeReadCatch = activeSessionEffect.match(/readMessages\(activeId\)[\s\S]*?\.catch\(\(error\) => \{[\s\S]*?\n      \}\);/)?.[0] ?? '';
    const refreshMessages = src.match(/async function refreshMessages\(sessionId: string\) \{[\s\S]*?\n  \}/)?.[0] ?? '';

    assert.match(
      activeSessionEffect,
      /const subscribedAt = Date\.now\(\);[\s\S]*setMessages\(\[\]\);[\s\S]*readMessages\(activeId\)/,
      'selecting a new active session must clear the old chat body before async message read resolves',
    );
    assert.match(
      activeSessionEffect,
      /if \(!disposed && activeIdRef\.current === activeId\) setMessages\(next\)/,
      'late active-session reads may set messages only while the same session is still active',
    );
    assert.match(
      activeReadCatch,
      /\.catch\(\(error\) => \{[\s\S]*const message = cleanErrorMessage\(error\);[\s\S]*setMessageLoadErrorBySession\(\(current\) => \(\{ \.\.\.current, \[activeId\]: message \}\)\);[\s\S]*toastApi\.error\('读取对话失败', message\)/,
      'active-session read failures must set a visible per-session load error after the old chat body has already been cleared',
    );
    assert.doesNotMatch(
      activeReadCatch,
      /已保留当前可见内容/,
      'the active read-failure toast must not claim visible content was preserved after the pre-read clear',
    );
    assert.doesNotMatch(
      activeReadCatch,
      /setMessages\(\[\]\)/,
      'the read-failure catch must not perform a second destructive clear; the pre-read clear is the only stale-content boundary',
    );
    assert.match(
      refreshMessages,
      /try \{[\s\S]*readMessages\(sessionId\)[\s\S]*activeIdRef\.current === sessionId[\s\S]*setMessages\(next\)[\s\S]*setMessageLoadErrorBySession[\s\S]*\} catch \(error\) \{[\s\S]*const message = cleanErrorMessage\(error\);[\s\S]*setMessageLoadErrorBySession\(\(current\) => \(\{ \.\.\.current, \[sessionId\]: message \}\)\);[\s\S]*toastApi\.error\('刷新对话失败', message\)/,
      'shared refreshMessages path must surface read failures through the same per-session load error state',
    );
    assert.doesNotMatch(
      refreshMessages,
      /catch \(error\) \{[\s\S]*setMessages\(\[\]\)/,
      'background message refresh failures must preserve the visible conversation instead of blanking the chat',
    );
    assert.match(
      src,
      /messageLoadError=\{activeId \? messageLoadErrorBySession\[activeId\] : undefined\}[\s\S]*onRetryMessages=\{activeId \? \(\) => void refreshMessages\(activeId\) : undefined\}/,
      'desktop shell must pass the active session load error and retry action to ChatView',
    );
    assert.match(
      ui,
      /props\.messageLoadError \? \([\s\S]*role="alert"[\s\S]*title="对话载入失败"[\s\S]*body=\{props\.messageLoadError\}[\s\S]*label: '重试载入'/,
      'ChatView must render an explicit load-error state instead of the normal empty chat hero',
    );
  });
});
