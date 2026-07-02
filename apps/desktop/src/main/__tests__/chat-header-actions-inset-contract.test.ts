import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readRendererContractCss } from './contract-css-helpers.js';

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(css);
  assert.ok(match, `${selector} rule should exist`);
  return match[1] ?? '';
}

describe('chat header actions inset contract', () => {
  // Companion to chat-status-cluster-layout-contract: PR-CHAT-HEADER-STATUS-CLUSTER-0
  // only relocated the status badge cluster. The in-header mode pill
  // (.maka-chat-header-mode-pill) and model switcher still flowed underneath the
  // absolutely-positioned .maka-workspace-top-actions toolbar in the top-right
  // corner. The header must reserve horizontal space for that toolbar.
  it('derives the toolbar inset token from the shared right baseline', async () => {
    const css = await readRendererContractCss();
    assert.match(
      css,
      /--maka-workspace-top-actions-inset:\s*calc\(\s*var\(--maka-workspace-top-actions-right\)/,
      'the inset token should extend the shared toolbar right baseline, not hardcode an unrelated value',
    );
  });

  it('reserves the toolbar inset as chat-header right padding', async () => {
    const css = await readRendererContractCss();
    const body = ruleBody(css, '.maka-chat-header');
    assert.match(
      body,
      /padding:[^;]*var\(--maka-workspace-top-actions-inset\)/,
      '.maka-chat-header must reserve --maka-workspace-top-actions-inset as right padding so right-aligned content does not render under .maka-workspace-top-actions',
    );
    assert.doesNotMatch(
      body,
      /padding:\s*0\s+10px\s*;/,
      'the header should no longer use the pre-fix symmetric 10px padding that let pills overlap the toolbar',
    );
  });
});
