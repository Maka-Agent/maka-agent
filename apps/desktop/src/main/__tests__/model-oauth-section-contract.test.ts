/**
 * Static-analysis contract for the OAuth model-provider catalog in
 * `apps/desktop/src/renderer/settings/ProvidersPanel.tsx`
 * (PR-MODEL-OAUTH-ALL-0).
 *
 * Pins the user-visible OAuth login surface: four cards
 * (claude / codex / antigravity / cursor), each marked
 * `status: 'available'`, and each click wires through to its
 * matching `window.maka.<provider>Subscription` bridge namespace.
 *
 * This is a source-grep contract, not a DOM render — we don't
 * pull React into the desktop test runner. Stamp shapes are
 * verified by reading the panel source.
 */

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const PROVIDERS_PANEL_SOURCE = resolve(
  REPO_ROOT,
  'apps',
  'desktop',
  'src',
  'renderer',
  'settings',
  'ProvidersPanel.tsx',
);
const PRELOAD_SOURCE = resolve(REPO_ROOT, 'apps', 'desktop', 'src', 'preload', 'preload.ts');

describe('Model OAuth catalog contract (PR-MODEL-OAUTH-ALL-0 + PR-CLAUDE-CARD-MOVE-0)', () => {
  it('renders OAuth as a catalog tab peer, not a standalone section above the market', async () => {
    const src = await readFile(PROVIDERS_PANEL_SOURCE, 'utf8');
    const tabs = src.match(/const CATALOG_TABS:[\s\S]*?\];/);
    assert.ok(tabs, 'CATALOG_TABS literal must exist');
    assert.match(tabs[0], /id:\s*'oauth'[\s\S]*label:\s*'OAuth'/, 'OAuth must be a catalog tab');
    assert.match(
      src,
      /catalogTab === 'oauth'\s*\?\s*\(\s*<ModelOAuthSection\s+onConnectionsChanged=\{reload\}\s*\/>/,
      'OAuth login UI must render from the tab content branch and refresh enabled models',
    );
    const marketStart = src.indexOf('<section className="providerMarket">');
    const firstOAuthRender = src.indexOf('<ModelOAuthSection');
    assert.ok(marketStart !== -1, 'provider market section must exist');
    assert.ok(firstOAuthRender > marketStart, 'ModelOAuthSection must not be pinned above providerMarket');
    assert.doesNotMatch(src, /providerOAuthHeader/, 'OAuth tab must not carry a second standalone section header');
  });

  it('provider config sheets expose their own accessible close button', async () => {
    const src = await readFile(PROVIDERS_PANEL_SOURCE, 'utf8');
    const styles = await readFile(resolve(REPO_ROOT, 'apps', 'desktop', 'src', 'renderer', 'styles.css'), 'utf8');
    const overlay = src.match(/function ProviderConfigSheetOverlay[\s\S]*?function ProviderCatalogCard/)?.[0] ?? '';

    assert.match(overlay, /className="providerConfigSheetClose"/);
    assert.match(overlay, /aria-label="关闭模型配置"/);
    assert.match(overlay, /<X strokeWidth=\{1\.75\} aria-hidden="true" \/>/);
    assert.match(styles, /\.providerConfigSheet\s*\{[\s\S]*position:\s*relative;/);
    assert.match(styles, /\.providerConfigSheetClose\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*14px;/);
    assert.match(styles, /\.providerConfigSheetClose:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--accent\);/);
  });

  it('exposes exactly four equal OAuth cards: claude, codex, antigravity, cursor', async () => {
    // WAWQAQ msg 8bb7e186: Claude must not be a huge standalone
    // inline card while the other OAuth providers are compact
    // cards. All four login entries live in the same grid.
    const src = await readFile(PROVIDERS_PANEL_SOURCE, 'utf8');
    const match = src.match(/MODEL_OAUTH_CARDS:\s*ReadonlyArray<ModelOAuthCard>\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(match, 'MODEL_OAUTH_CARDS literal must exist');
    const body = match[1]!;
    const ids = [...body.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]);
    assert.deepEqual(
      ids.sort(),
      ['antigravity', 'claude', 'codex', 'cursor'],
      'grid must include exactly claude / codex / antigravity / cursor',
    );
  });

  it('every card declares status: "available" (no more "planned" placeholders)', async () => {
    const src = await readFile(PROVIDERS_PANEL_SOURCE, 'utf8');
    const match = src.match(/MODEL_OAUTH_CARDS:\s*ReadonlyArray<ModelOAuthCard>\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(match, 'MODEL_OAUTH_CARDS literal must exist');
    const body = match[1]!;
    const statuses = [...body.matchAll(/status:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    assert.equal(statuses.length, 4, 'each card must declare a status');
    for (const s of statuses) {
      assert.equal(s, 'available', `card status must be 'available', got '${s}'`);
    }
    assert.doesNotMatch(body, /'planned'/, 'no card may still claim "planned" status');
  });

  it('claude opens a modal from the equal-size card instead of rendering a full inline card above the grid', async () => {
    const src = await readFile(PROVIDERS_PANEL_SOURCE, 'utf8');
    const sectionMatch = src.match(/function ModelOAuthSection[\s\S]*?function ClaudeSubscriptionModal/);
    assert.ok(sectionMatch, 'ModelOAuthSection and ClaudeSubscriptionModal must exist');
    assert.doesNotMatch(
      sectionMatch[0],
      /<ClaudeSubscriptionCard\s*\/>/,
      'ModelOAuthSection must not render the full Claude card inline above the OAuth grid',
    );
    assert.match(
      src,
      /openModal === 'claude'[\s\S]*<ClaudeSubscriptionModal/,
      'Claude card must open the provider-specific modal',
    );
    assert.doesNotMatch(
      src,
      /maka:jumpToSettingsSection[\s\S]*?'account'/,
      'after the card move, ModelOAuthSection must NOT jump to the account section',
    );
    assert.match(
      src,
      /setOpenModal\(card\.id\)/,
      'all OAuth cards must open a modal from the grid',
    );
  });

  it('ModelOAuthSection re-fetches account state on modal close so card badges stay live (PR-OAUTH-CARD-LIVE-STATE-0)', async () => {
    // WAWQAQ msg d79fd115 follow-up: after a user completed the
    // OAuth flow in SubscriptionLoginModal, the parent card still
    // showed "可用 / 预览" — no live login indicator. The fix
    // lifts a per-service snapshot map into the section and
    // refreshes on every modal close (success OR cancel).
    const src = await readFile(PROVIDERS_PANEL_SOURCE, 'utf8');
    // 1. cardStates map keyed by service id must exist.
    assert.match(
      src,
      /cardStates\s*,\s*setCardStates\b/,
      'ModelOAuthSection must track per-service snapshots',
    );
    // 2. refreshAllCards must call getAccountState for each card.
    assert.match(
      src,
      /async function refreshAllCards\(\)/,
      'must define refreshAllCards()',
    );
    assert.match(
      src,
      /getSubscriptionSnapshot\(card\.id\)/,
      'refreshAllCards must query each subscription snapshot',
    );
    // 3. useEffect on mount fires the initial refresh.
    const refreshOnMount = src.match(/useEffect\(\(\) =>\s*\{\s*void refreshAllCards\(\);[\s\S]*?\},\s*\[\]\)/);
    assert.ok(refreshOnMount, 'ModelOAuthSection must refresh on mount');
    // 4. Modal onClose triggers a re-fetch.
    assert.match(
      src,
      /onClose=\{\(\)\s*=>\s*\{[\s\S]*?refreshAllCards\(\)/,
      'modal onClose must call refreshAllCards so the card updates after login',
    );
    // 5. Card render shows "已登录" badge when authenticated.
    assert.match(
      src,
      /isLoggedIn\s*\?\s*'已登录'\s*:\s*card\.statusLabel/,
      'logged-in cards must show 已登录 instead of the static statusLabel',
    );
    // 6. data-logged-in attribute exposes the state to CSS / tests.
    assert.match(
      src,
      /data-logged-in=\{isLoggedIn\s*\?\s*'true'\s*:\s*undefined\}/,
      'logged-in cards must surface a data-logged-in attribute',
    );
  });

  it('SettingsModal validates jumpToSettingsSection payloads against SETTINGS_NAV (PR-OAUTH-CARD-LIVE-STATE-0)', async () => {
    // Before: any truthy `detail.section` was passed to setSection,
    // so a typo or stale dispatch would silently land the user on
    // the "该设置页已纳入 Maka 设置树…" fallback page with no clue.
    const SETTINGS_MODAL = resolve(
      REPO_ROOT, 'apps', 'desktop', 'src', 'renderer', 'settings', 'SettingsModal.tsx',
    );
    const src = await readFile(SETTINGS_MODAL, 'utf8');
    // Find the handler body — match from `const handler = ` up to
    // its `addEventListener(...)` registration.
    const handler = src.match(
      /const handler =[\s\S]*?window\.addEventListener\(\s*'maka:jumpToSettingsSection'/,
    );
    assert.ok(handler, 'jumpToSettingsSection handler must exist');
    assert.match(
      handler[0],
      /SETTINGS_NAV\.some\(/,
      'jump handler must validate the section id against SETTINGS_NAV before calling setSection',
    );
  });

  it('AccountSettingsPage no longer renders ClaudeSubscriptionCard', async () => {
    // The 账户 panel used to host the card; PR-CLAUDE-CARD-MOVE-0
    // removed it. Confirm SettingsModal no longer references it.
    const SETTINGS_MODAL = resolve(
      REPO_ROOT, 'apps', 'desktop', 'src', 'renderer', 'settings', 'SettingsModal.tsx',
    );
    const src = await readFile(SETTINGS_MODAL, 'utf8');
    assert.doesNotMatch(
      src,
      /<ClaudeSubscriptionCard\s*\/>/,
      'SettingsModal must not render ClaudeSubscriptionCard — it lives in ProvidersPanel now',
    );
    assert.doesNotMatch(
      src,
      /function ClaudeSubscriptionCard\b/,
      'ClaudeSubscriptionCard definition must be in ProvidersPanel, not SettingsModal',
    );
  });

  it('SubscriptionLoginModal picks the right service bridge per id', async () => {
    const src = await readFile(PROVIDERS_PANEL_SOURCE, 'utf8');
    const fnMatch = src.match(/function pickSubscriptionBridge\(serviceId:[\s\S]*?^\}/m);
    assert.ok(fnMatch, 'pickSubscriptionBridge helper must exist');
    const body = fnMatch[0];
    assert.doesNotMatch(body, /case 'claude'/, 'Claude has a paste-code modal and must not use the loopback generic bridge');
    assert.match(body, /case 'codex'[\s\S]*?window\.maka\.codexSubscription/);
    assert.match(body, /case 'cursor'[\s\S]*?window\.maka\.cursorSubscription/);
    assert.match(body, /case 'antigravity'[\s\S]*?window\.maka\.antigravitySubscription/);
  });

  it('modal flow calls getAuthUrl → openAuthUrl → completeAuthorization on the bridge', async () => {
    const src = await readFile(PROVIDERS_PANEL_SOURCE, 'utf8');
    const fnMatch = src.match(/async function startLogin\(\)[\s\S]*?\n  \}/);
    assert.ok(fnMatch, 'startLogin must exist on SubscriptionLoginModal');
    const body = fnMatch[0];
    assert.match(body, /bridge\.getAuthUrl\(\)/);
    assert.match(body, /bridge\.openAuthUrl\(payload\.authRequestId\)/);
    assert.match(body, /bridge\.completeAuthorization\(payload\.authRequestId\)/);
  });

  it('preload exposes the three new subscription namespaces alongside claudeSubscription', async () => {
    const src = await readFile(PRELOAD_SOURCE, 'utf8');
    assert.match(src, /codexSubscription:\s*\{/, 'preload must expose window.maka.codexSubscription');
    assert.match(src, /cursorSubscription:\s*\{/, 'preload must expose window.maka.cursorSubscription');
    assert.match(
      src,
      /antigravitySubscription:\s*\{/,
      'preload must expose window.maka.antigravitySubscription',
    );
    for (const channel of [
      'codex-subscription:get-auth-url',
      'codex-subscription:complete-authorization',
      'codex-subscription:get-account-state',
      'codex-subscription:logout',
      'cursor-subscription:get-auth-url',
      'cursor-subscription:complete-authorization',
      'cursor-subscription:get-account-state',
      'cursor-subscription:logout',
      'antigravity-subscription:get-auth-url',
      'antigravity-subscription:complete-authorization',
      'antigravity-subscription:get-account-state',
      'antigravity-subscription:logout',
    ]) {
      assert.match(
        src,
        new RegExp(channel.replace(/:/g, ':').replace(/-/g, '-')),
        `preload must invoke '${channel}' on the IPC bus`,
      );
    }
  });
});
