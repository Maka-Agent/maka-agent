/**
 * Tests for the renderer-side derived connection UI status. The function lives
 * in `apps/desktop/src/renderer/connection-status.ts` but is a pure helper —
 * no React, no DOM — so we exercise it directly via node:test from the
 * desktop test runner.
 *
 * The invariants under test are the ones @kenji's status contract requires
 * (priority order, no mixed labels), plus the Ollama edge case (no secret
 * required but still needs a defaultModel) and the failure-doesn't-disable
 * invariant.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  deriveConnectionUiStatus,
  type ConnectionUiStatusInput,
} from '../../renderer/connection-status.js';

function base(input: Partial<ConnectionUiStatusInput> = {}): ConnectionUiStatusInput {
  return {
    enabled: true,
    hasSecret: true,
    defaultModel: 'claude-sonnet-4-5-20250929',
    lastTestStatus: undefined,
    authKind: 'api_key',
    ...input,
  };
}

describe('deriveConnectionUiStatus', () => {
  describe('priority order (highest wins)', () => {
    it('disabled overrides every other signal', () => {
      // Even if everything else says verified, disabled is a user lifecycle
      // state that takes precedence — never produce "disabled + verified".
      assert.equal(
        deriveConnectionUiStatus(base({ enabled: false, lastTestStatus: 'verified' })),
        'disabled',
      );
      assert.equal(
        deriveConnectionUiStatus(base({ enabled: false, hasSecret: false, defaultModel: undefined })),
        'disabled',
      );
    });

    it('not_configured beats lastTestStatus when secret is missing', () => {
      // If the user wipes the API key, a stale verified state must NOT survive.
      // (Backend invalidation also clears lastTestStatus in this case, but the
      // UI derive layer is the second line of defense.)
      assert.equal(
        deriveConnectionUiStatus(base({ hasSecret: false, lastTestStatus: 'verified' })),
        'not_configured',
      );
    });

    it('not_configured beats lastTestStatus when defaultModel is missing', () => {
      assert.equal(
        deriveConnectionUiStatus(base({ defaultModel: undefined, lastTestStatus: 'verified' })),
        'not_configured',
      );
      assert.equal(
        deriveConnectionUiStatus(base({ defaultModel: '', lastTestStatus: 'verified' })),
        'not_configured',
      );
    });
  });

  describe('lastTestStatus mapping', () => {
    it('verified → verified', () => {
      assert.equal(deriveConnectionUiStatus(base({ lastTestStatus: 'verified' })), 'verified');
    });

    it('needs_reauth → needs_reauth', () => {
      assert.equal(deriveConnectionUiStatus(base({ lastTestStatus: 'needs_reauth' })), 'needs_reauth');
    });

    it('error → error', () => {
      assert.equal(deriveConnectionUiStatus(base({ lastTestStatus: 'error' })), 'error');
    });

    it('undefined (never tested but configured) → configured', () => {
      assert.equal(deriveConnectionUiStatus(base()), 'configured');
    });
  });

  describe('Ollama / authKind === "none" path', () => {
    it('does not require hasSecret when authKind is "none"', () => {
      // Local Ollama has no API key; hasSecret will report false from the
      // safeStorage check but the connection is still usable as long as
      // defaultModel is set.
      assert.equal(
        deriveConnectionUiStatus(
          base({ authKind: 'none', hasSecret: false, lastTestStatus: 'verified' }),
        ),
        'verified',
      );
      assert.equal(
        deriveConnectionUiStatus(
          base({ authKind: 'none', hasSecret: false, lastTestStatus: undefined }),
        ),
        'configured',
      );
    });

    it('still requires defaultModel when authKind is "none"', () => {
      // Per kenji's review: a no-secret local provider with no model picked
      // must NOT render as ready.
      assert.equal(
        deriveConnectionUiStatus(
          base({ authKind: 'none', hasSecret: false, defaultModel: undefined }),
        ),
        'not_configured',
      );
    });
  });

  describe('failure-does-not-disable invariant', () => {
    it('a connection that just errored stays enabled (status = error, not disabled)', () => {
      // Test invariant: backend never auto-disables on a test failure.
      // UI should reflect "error status on an enabled connection", not
      // collapse to disabled. This is the regression we'd see if the UI
      // ever wrote enabled=false on its own.
      assert.equal(
        deriveConnectionUiStatus(base({ enabled: true, lastTestStatus: 'error' })),
        'error',
      );
      assert.equal(
        deriveConnectionUiStatus(base({ enabled: true, lastTestStatus: 'needs_reauth' })),
        'needs_reauth',
      );
    });
  });
});
