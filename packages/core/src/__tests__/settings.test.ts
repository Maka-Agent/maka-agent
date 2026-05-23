import { describe, test } from 'node:test';
import { expect } from '../test-helpers.js';
import {
  THEME_PALETTES,
  TOAST_POSITIONS,
  createDefaultBotChannel,
  createDefaultSettings,
  isThemePalette,
  isToastPosition,
  mergeSettings,
  normalizeSettings,
} from '../settings.js';

describe('bot readiness settings contract', () => {
  test('default bot channels are scaffolded, not operational', () => {
    const channel = createDefaultBotChannel('telegram');

    expect(channel.connected).toBe(false);
    expect(channel.readiness).toBe('scaffolded');
  });

  test('normalizes legacy connected boolean to credentials_valid, not operational', () => {
    const legacy = createDefaultSettings();
    const telegram = legacy.botChat.channels.telegram as Partial<typeof legacy.botChat.channels.telegram>;
    delete telegram.readiness;
    legacy.botChat.channels.telegram.connected = true;
    legacy.botChat.channels.telegram.enabled = true;
    legacy.botChat.channels.telegram.token = 'telegram-token';

    const normalized = normalizeSettings(legacy);

    expect(normalized.botChat.channels.telegram.connected).toBe(true);
    expect(normalized.botChat.channels.telegram.readiness).toBe('credentials_valid');
  });

  test('does not treat non-boolean legacy connected values as credentials_valid', () => {
    const legacy = createDefaultSettings() as unknown as {
      botChat: { channels: { telegram: { connected: unknown; readiness?: unknown; enabled: boolean; token: string } } };
    };
    delete legacy.botChat.channels.telegram.readiness;
    legacy.botChat.channels.telegram.connected = 'true';
    legacy.botChat.channels.telegram.enabled = true;
    legacy.botChat.channels.telegram.token = 'telegram-token';

    const normalized = normalizeSettings(legacy);

    expect(normalized.botChat.channels.telegram.connected).toBe(false);
    expect(normalized.botChat.channels.telegram.readiness).toBe('configured');
  });

  test('normalizes enabled configured channels to configured, not operational', () => {
    const legacy = createDefaultSettings();
    const discord = legacy.botChat.channels.discord as Partial<typeof legacy.botChat.channels.discord>;
    delete discord.readiness;
    legacy.botChat.channels.discord.enabled = true;
    legacy.botChat.channels.discord.token = 'discord-token';

    const normalized = normalizeSettings(legacy);

    expect(normalized.botChat.channels.discord.readiness).toBe('configured');
  });
});

describe('theme palette settings contract (PR-UI-D1, @kenji msg 68bf2b13)', () => {
  test('THEME_PALETTES allowlist has 5 entries including default', () => {
    expect(THEME_PALETTES.length).toBe(5);
    expect(THEME_PALETTES.includes('default')).toBe(true);
    expect(THEME_PALETTES.includes('onedark')).toBe(true);
    expect(THEME_PALETTES.includes('catppuccin-mocha')).toBe(true);
    expect(THEME_PALETTES.includes('tokyo-night')).toBe(true);
    expect(THEME_PALETTES.includes('nord')).toBe(true);
  });

  test('isThemePalette accepts allowlist values, rejects everything else', () => {
    for (const palette of THEME_PALETTES) {
      expect(isThemePalette(palette)).toBe(true);
    }
    expect(isThemePalette('evil-unknown')).toBe(false);
    expect(isThemePalette('')).toBe(false);
    expect(isThemePalette(undefined)).toBe(false);
    expect(isThemePalette(null)).toBe(false);
    expect(isThemePalette(42)).toBe(false);
    expect(isThemePalette({ palette: 'onedark' })).toBe(false);
    expect(isThemePalette([])).toBe(false);
    // Case-sensitive: TypeScript union is exact-case, runtime guard must agree.
    expect(isThemePalette('Default')).toBe(false);
    expect(isThemePalette('ONEDARK')).toBe(false);
  });

  test('createDefaultSettings seeds palette as `default`', () => {
    const defaults = createDefaultSettings();
    expect(defaults.appearance.palette).toBe('default');
  });

  test('migration: settings.json without `palette` field loads with palette=default', () => {
    // Older settings.json that pre-dates PR-UI-D1 will not have
    // `appearance.palette`. normalizeSettings must seed `default`
    // without touching theme/density.
    const legacy = {
      appearance: {
        theme: 'dark' as const,
        density: 'compact' as const,
        // no palette field
      },
    };
    const normalized = normalizeSettings(legacy);
    expect(normalized.appearance.palette).toBe('default');
    expect(normalized.appearance.theme).toBe('dark');
    expect(normalized.appearance.density).toBe('compact');
  });

  test('fail-closed: unknown palette string falls back to default', () => {
    const malformed = {
      appearance: {
        theme: 'auto' as const,
        density: 'comfortable' as const,
        palette: 'evil-unknown',
      },
    };
    const normalized = normalizeSettings(malformed);
    expect(normalized.appearance.palette).toBe('default');
  });

  test('fail-closed: non-string palette falls back to default', () => {
    for (const bad of [42, true, null, {}, []]) {
      const malformed = {
        appearance: {
          theme: 'auto' as const,
          density: 'comfortable' as const,
          palette: bad,
        },
      };
      const normalized = normalizeSettings(malformed);
      expect(normalized.appearance.palette).toBe('default');
    }
  });

  test('valid palette survives normalize untouched', () => {
    for (const palette of THEME_PALETTES) {
      const input = {
        appearance: {
          theme: 'auto' as const,
          density: 'comfortable' as const,
          palette,
        },
      };
      const normalized = normalizeSettings(input);
      expect(normalized.appearance.palette).toBe(palette);
    }
  });

  test('palette validation does NOT silently reset unrelated settings fields', () => {
    // @kenji gate: "no silent reset of unrelated settings". Even with
    // a malformed palette, all other fields (theme, density,
    // personalization, network, bot channels) must keep their values.
    const input = {
      appearance: {
        theme: 'dark' as const,
        density: 'spacious' as const,
        palette: 'evil-unknown',
      },
      personalization: {
        displayName: 'Yuejing',
        assistantTone: 'concise',
      },
      network: {
        proxy: {
          enabled: true,
          protocol: 'http' as const,
          host: '127.0.0.1',
          port: 7890,
          authEnabled: false,
          username: '',
          password: '',
          bypassList: ['localhost'],
          autoBypassDomains: [],
        },
      },
    };
    const normalized = normalizeSettings(input);
    expect(normalized.appearance.palette).toBe('default');
    expect(normalized.appearance.theme).toBe('dark');
    expect(normalized.appearance.density).toBe('spacious');
    expect(normalized.personalization.displayName).toBe('Yuejing');
    expect(normalized.personalization.assistantTone).toBe('concise');
    expect(normalized.network.proxy.enabled).toBe(true);
    expect(normalized.network.proxy.host).toBe('127.0.0.1');
    expect(normalized.network.proxy.port).toBe(7890);
  });

  test('mergeSettings carries palette through patch surface', () => {
    const current = createDefaultSettings();
    const patched = mergeSettings(current, { appearance: { palette: 'onedark' } });
    expect(patched.appearance.palette).toBe('onedark');
    expect(patched.appearance.theme).toBe('auto'); // unchanged
    expect(patched.appearance.density).toBe('comfortable'); // unchanged
  });

  test('mergeSettings + normalizeSettings: patching with unknown palette ends up at default', () => {
    // Real-world: a UI might submit a misconfigured palette via the
    // patch surface. The normalize pass after mergeSettings catches it.
    const current = createDefaultSettings();
    const patched = mergeSettings(current, {
      appearance: { palette: 'evil-unknown' as 'default' /* coerced for test */ },
    });
    const normalized = normalizeSettings(patched);
    expect(normalized.appearance.palette).toBe('default');
  });
});

describe('toast position settings contract (PR-UI-D2, @kenji msg eef6f7a5)', () => {
  test('TOAST_POSITIONS allowlist has 6 entries (grid corners)', () => {
    expect(TOAST_POSITIONS.length).toBe(6);
    expect(TOAST_POSITIONS.includes('top-left')).toBe(true);
    expect(TOAST_POSITIONS.includes('top-center')).toBe(true);
    expect(TOAST_POSITIONS.includes('top-right')).toBe(true);
    expect(TOAST_POSITIONS.includes('bottom-left')).toBe(true);
    expect(TOAST_POSITIONS.includes('bottom-center')).toBe(true);
    expect(TOAST_POSITIONS.includes('bottom-right')).toBe(true);
  });

  test('isToastPosition accepts allowlist values, rejects everything else', () => {
    for (const pos of TOAST_POSITIONS) {
      expect(isToastPosition(pos)).toBe(true);
    }
    expect(isToastPosition('evil-corner')).toBe(false);
    expect(isToastPosition('')).toBe(false);
    expect(isToastPosition(undefined)).toBe(false);
    expect(isToastPosition(null)).toBe(false);
    expect(isToastPosition(42)).toBe(false);
    expect(isToastPosition({ toastPosition: 'top-left' })).toBe(false);
    expect(isToastPosition([])).toBe(false);
    // Case-sensitive: TypeScript union is exact-case, runtime guard must agree.
    expect(isToastPosition('Top-Left')).toBe(false);
    expect(isToastPosition('TOP-RIGHT')).toBe(false);
    // No abbreviations / no synonyms.
    expect(isToastPosition('top')).toBe(false);
    expect(isToastPosition('center')).toBe(false);
    expect(isToastPosition('topleft')).toBe(false);
  });

  test('createDefaultSettings seeds toastPosition as `bottom-right`', () => {
    const defaults = createDefaultSettings();
    expect(defaults.appearance.toastPosition).toBe('bottom-right');
  });

  test('migration: settings.json without `toastPosition` field loads with bottom-right', () => {
    // Pre-PR-UI-D2 settings.json had no `appearance.toastPosition`.
    // normalizeSettings must seed `bottom-right` (preserves v1
    // behavior) without touching theme/density/palette.
    const legacy = {
      appearance: {
        theme: 'dark' as const,
        density: 'compact' as const,
        palette: 'onedark' as const,
        // no toastPosition field
      },
    };
    const normalized = normalizeSettings(legacy);
    expect(normalized.appearance.toastPosition).toBe('bottom-right');
    expect(normalized.appearance.theme).toBe('dark');
    expect(normalized.appearance.density).toBe('compact');
    expect(normalized.appearance.palette).toBe('onedark');
  });

  test('fail-closed: unknown toastPosition string falls back to bottom-right', () => {
    const malformed = {
      appearance: {
        theme: 'auto' as const,
        density: 'comfortable' as const,
        toastPosition: 'evil-corner',
      },
    };
    const normalized = normalizeSettings(malformed);
    expect(normalized.appearance.toastPosition).toBe('bottom-right');
  });

  test('fail-closed: non-string toastPosition falls back to bottom-right', () => {
    for (const bad of [42, true, null, {}, []]) {
      const malformed = {
        appearance: {
          theme: 'auto' as const,
          density: 'comfortable' as const,
          toastPosition: bad,
        },
      };
      const normalized = normalizeSettings(malformed);
      expect(normalized.appearance.toastPosition).toBe('bottom-right');
    }
  });

  test('valid toastPosition survives normalize untouched', () => {
    for (const pos of TOAST_POSITIONS) {
      const input = {
        appearance: {
          theme: 'auto' as const,
          density: 'comfortable' as const,
          toastPosition: pos,
        },
      };
      const normalized = normalizeSettings(input);
      expect(normalized.appearance.toastPosition).toBe(pos);
    }
  });

  test('toastPosition validation does NOT silently reset unrelated settings fields', () => {
    // @kenji gate: "no silent reset of unrelated settings". Even with
    // a malformed toastPosition, all other fields (theme, density,
    // palette, personalization, network) must keep their values.
    const input = {
      appearance: {
        theme: 'dark' as const,
        density: 'spacious' as const,
        palette: 'tokyo-night' as const,
        toastPosition: 'evil-corner',
      },
      personalization: {
        displayName: 'Yuejing',
        assistantTone: 'concise',
      },
    };
    const normalized = normalizeSettings(input);
    expect(normalized.appearance.toastPosition).toBe('bottom-right');
    expect(normalized.appearance.theme).toBe('dark');
    expect(normalized.appearance.density).toBe('spacious');
    expect(normalized.appearance.palette).toBe('tokyo-night');
    expect(normalized.personalization.displayName).toBe('Yuejing');
    expect(normalized.personalization.assistantTone).toBe('concise');
  });

  test('mergeSettings carries toastPosition through patch surface', () => {
    const current = createDefaultSettings();
    const patched = mergeSettings(current, { appearance: { toastPosition: 'top-center' } });
    expect(patched.appearance.toastPosition).toBe('top-center');
    expect(patched.appearance.theme).toBe('auto'); // unchanged
    expect(patched.appearance.palette).toBe('default'); // unchanged
  });

  test('mergeSettings + normalizeSettings: patching with unknown toastPosition ends up at default', () => {
    const current = createDefaultSettings();
    const patched = mergeSettings(current, {
      appearance: { toastPosition: 'evil-corner' as 'bottom-right' /* coerced for test */ },
    });
    const normalized = normalizeSettings(patched);
    expect(normalized.appearance.toastPosition).toBe('bottom-right');
  });

  test('palette + toastPosition both malformed → both fall back independently to defaults', () => {
    // Cross-contract sanity: D1 + D2 normalizers don't interfere.
    const input = {
      appearance: {
        theme: 'auto' as const,
        density: 'comfortable' as const,
        palette: 'evil-unknown',
        toastPosition: 'evil-corner',
      },
    };
    const normalized = normalizeSettings(input);
    expect(normalized.appearance.palette).toBe('default');
    expect(normalized.appearance.toastPosition).toBe('bottom-right');
  });
});
