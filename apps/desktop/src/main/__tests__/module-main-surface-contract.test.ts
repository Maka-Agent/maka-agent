import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { join } from 'node:path';

const repoRoot = process.cwd().endsWith('apps/desktop')
  ? join(process.cwd(), '..', '..')
  : process.cwd();

async function readRepo(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8');
}

describe('module main surface contract', () => {
  it('renders Daily Review in the main content pane, not the sidebar list pane', async () => {
    const ui = await readRepo('packages/ui/src/components.tsx');
    const sidebarListBlock = ui.match(/<section className="maka-session-list"[\s\S]*?<footer className="maka-session-panel-footer">/)?.[0] ?? '';
    const dailyReviewModeBlock = ui.match(/if \(props\.mode === 'daily-review'\) \{[\s\S]*?^\s*\}/m)?.[0] ?? '';

    assert.match(dailyReviewModeBlock, /className="maka-main detailPane maka-module-main"/);
    assert.match(dailyReviewModeBlock, /<DailyReviewPanel/);
    assert.doesNotMatch(sidebarListBlock, /<DailyReviewPanel/);
    assert.match(sidebarListBlock, /title="每日回顾"[\s\S]*body="已在右侧内容栏打开。"/);
  });

  it('renders Skills in the main content pane, not as a left-bottom list', async () => {
    const ui = await readRepo('packages/ui/src/components.tsx');
    const sidebarListBlock = ui.match(/<section className="maka-session-list"[\s\S]*?<footer className="maka-session-panel-footer">/)?.[0] ?? '';
    const skillsModeBlock = ui.match(/if \(props\.mode === 'skills'\) \{[\s\S]*?^\s*\}/m)?.[0] ?? '';

    assert.match(skillsModeBlock, /className="maka-main detailPane maka-module-main"/);
    assert.match(skillsModeBlock, /<SkillLibraryPanel/);
    assert.doesNotMatch(sidebarListBlock, /<SkillLibraryPanel/);
    assert.match(sidebarListBlock, /title="技能库"[\s\S]*body="已在右侧内容栏打开。"/);
  });

  it('renders Plan reminders in the main content pane, not as a left-bottom form', async () => {
    const ui = await readRepo('packages/ui/src/components.tsx');
    const sidebarListBlock = ui.match(/<section className="maka-session-list"[\s\S]*?<footer className="maka-session-panel-footer">/)?.[0] ?? '';
    const automationsModeBlock = ui.match(/if \(props\.mode === 'automations'\) \{[\s\S]*?^\s*\}/m)?.[0] ?? '';

    assert.match(automationsModeBlock, /className="maka-main detailPane maka-module-main"/);
    assert.match(automationsModeBlock, /<PlanReminderPanel/);
    assert.doesNotMatch(sidebarListBlock, /<PlanReminderPanel/);
    assert.match(sidebarListBlock, /title="计划"[\s\S]*body="已在右侧内容栏打开。"/);
  });

  it('uses a segmented language control instead of a native select in Settings personalization', async () => {
    const settings = await readRepo('apps/desktop/src/renderer/settings/SettingsModal.tsx');
    const personalizationBlock = settings.match(/function PersonalizationSettingsPage[\s\S]*?function ThemePreviewMock/)?.[0] ?? '';

    assert.match(personalizationBlock, /<Segmented[\s\S]*ariaLabel="界面语言"/);
    assert.doesNotMatch(personalizationBlock, /<select[\s\S]*aria-label="界面语言"/);
    assert.match(settings, /role="radiogroup"[\s\S]*aria-label=\{props\.ariaLabel\}/);
    assert.match(settings, /role="radio"[\s\S]*aria-checked=\{props\.value === value\}/);
  });

  it('keeps visual-smoke scenarios for the main module surfaces', async () => {
    const fixture = await readRepo('apps/desktop/src/main/visual-smoke-fixture.ts');
    const screenshots = await readRepo('scripts/capture-screenshots.mjs');

    assert.match(fixture, /'module-skills'/);
    assert.match(fixture, /'module-daily-review'/);
    assert.match(fixture, /'plan-reminders'/);
    assert.match(screenshots, /'module-skills'/);
    assert.match(screenshots, /'module-daily-review'/);
    assert.match(screenshots, /'plan-reminders'/);
  });

  it('uses an inset accent focus treatment for form fields instead of an exterior grey rectangle', async () => {
    const css = await readRepo('apps/desktop/src/renderer/styles.css');
    const focusRule = css.match(/:where\(input, select, textarea\):focus\s*\{[\s\S]*?\}/)?.[0] ?? '';

    assert.match(focusRule, /outline:\s*none/);
    assert.match(focusRule, /border-color:\s*oklch\(from var\(--accent\)/);
    assert.match(focusRule, /box-shadow:\s*inset 0 0 0 1px oklch\(from var\(--accent\)/);
    assert.match(focusRule, /!important/);
  });
});
