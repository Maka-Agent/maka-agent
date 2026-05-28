/**
 * Tests for PR-LANG-PREF-0 — closed UiLocalePreference enum +
 * settings persistence + fail-closed normalization.
 *
 * Verification points (kenji `7e532892` + xuan `54b56858`):
 *   - Default `personalization.uiLocale` is `'auto'`.
 *   - Unknown values fail closed to `'auto'`.
 *   - All 3 enum values round-trip through normalizeSettings.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  UI_LOCALE_PREFERENCES,
  createDefaultSettings,
  isUiLocalePreference,
  normalizeSettings,
  type UiLocalePreference,
} from '../settings.js';

describe('UiLocalePreference closed enum', () => {
  it('exposes the canonical ordering auto / zh / en', () => {
    assert.deepEqual([...UI_LOCALE_PREFERENCES], ['auto', 'zh', 'en']);
  });

  it('isUiLocalePreference accepts only the three known values', () => {
    assert.equal(isUiLocalePreference('auto'), true);
    assert.equal(isUiLocalePreference('zh'), true);
    assert.equal(isUiLocalePreference('en'), true);
    assert.equal(isUiLocalePreference('jp'), false);
    assert.equal(isUiLocalePreference(''), false);
    assert.equal(isUiLocalePreference(null), false);
    assert.equal(isUiLocalePreference(undefined), false);
    assert.equal(isUiLocalePreference(42), false);
    assert.equal(isUiLocalePreference({}), false);
  });
});

describe('createDefaultSettings — uiLocale default', () => {
  it('defaults personalization.uiLocale to "auto"', () => {
    const defaults = createDefaultSettings();
    assert.equal(defaults.personalization.uiLocale, 'auto');
  });
});

describe('normalizeSettings — uiLocale fail-closed', () => {
  it('preserves a valid persisted choice', () => {
    for (const choice of UI_LOCALE_PREFERENCES) {
      const input = {
        ...createDefaultSettings(),
        personalization: {
          displayName: '',
          assistantTone: '',
          uiLocale: choice,
        },
      };
      const normalized = normalizeSettings(input);
      assert.equal(normalized.personalization.uiLocale, choice);
    }
  });

  it('fails closed to "auto" when the persisted value is unknown', () => {
    const input = {
      ...createDefaultSettings(),
      personalization: {
        displayName: '',
        assistantTone: '',
        uiLocale: 'klingon' as UiLocalePreference,
      },
    };
    const normalized = normalizeSettings(input);
    assert.equal(normalized.personalization.uiLocale, 'auto');
  });

  it('fails closed when the field is missing', () => {
    const input = {
      ...createDefaultSettings(),
      personalization: { displayName: '', assistantTone: '' } as {
        displayName: string;
        assistantTone: string;
        uiLocale: UiLocalePreference;
      },
    };
    delete (input.personalization as unknown as Record<string, unknown>).uiLocale;
    const normalized = normalizeSettings(input);
    assert.equal(normalized.personalization.uiLocale, 'auto');
  });
});
