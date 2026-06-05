import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = process.cwd().endsWith('apps/desktop')
  ? join(process.cwd(), '..', '..')
  : process.cwd();

async function readRepo(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8');
}

describe('Settings theme page contract', () => {
  it('keeps instant appearance preview but surfaces persistence failures', async () => {
    const src = await readRepo('apps/desktop/src/renderer/settings/SettingsModal.tsx');
    const themePage = src.match(/function ThemeSettingsPage\([\s\S]*?function WebSearchSettingsPage/);

    assert.ok(themePage, 'Theme settings page block must exist');
    assert.match(
      themePage![0],
      /async function persistAppearance\(patch: NonNullable<Parameters<typeof window\.maka\.settings\.update>\[0\]\['appearance'\]>\)/,
      'Theme page must centralize appearance persistence',
    );
    assert.match(
      themePage![0],
      /try \{[\s\S]*await props\.onUpdate\(\{ appearance: patch \}\)[\s\S]*catch \(error\) \{[\s\S]*toast\.error\('保存外观设置失败', settingsActionErrorMessage\(error\)\)/,
      'Appearance persistence failures must show a user-visible toast',
    );
    assert.match(
      themePage![0],
      /props\.onThemeChange\(next\);[\s\S]*await persistAppearance\(\{ theme: next \}\)/,
      'Theme changes must keep instant preview before persisting',
    );
    assert.match(
      themePage![0],
      /props\.onDensityChange\(next\);[\s\S]*await persistAppearance\(\{ density: next \}\)/,
      'Density changes must keep instant preview before persisting',
    );
    assert.match(
      themePage![0],
      /props\.onThemePaletteChange\(next\);[\s\S]*await persistAppearance\(\{ palette: next \}\)/,
      'Palette changes must keep instant preview before persisting',
    );
    assert.doesNotMatch(
      themePage![0],
      /await props\.onUpdate\(\{ appearance: \{ (theme|density|palette): next \} \}\)/,
      'Appearance controls must not call raw settings update without the fail-soft helper',
    );
  });

  it('supports standard radiogroup keyboard navigation for appearance controls', async () => {
    const src = await readRepo('apps/desktop/src/renderer/settings/SettingsModal.tsx');
    const helperBlock = src.match(/function onSettingsRadioGroupKeyDown[\s\S]*?function radioTabIndex/)?.[0] ?? '';
    const themePage = src.match(/function ThemeSettingsPage\([\s\S]*?function WebSearchSettingsPage/)?.[0] ?? '';
    const segmentedBlock = src.match(/function Segmented[\s\S]*?function Switch/)?.[0] ?? '';

    assert.match(helperBlock, /nextRadioId\(current, values, event\.key\)/);
    assert.match(helperBlock, /event\.preventDefault\(\)/);
    assert.match(helperBlock, /onChange\(next\)/);
    assert.match(helperBlock, /const group = event\.currentTarget/);
    assert.match(helperBlock, /setTimeout\(\(\) => focusRadioValue\(group, next\), 0\)/);
    assert.match(themePage, /aria-label="主题"[\s\S]*onKeyDown=\{\(event\) => onSettingsRadioGroupKeyDown/);
    assert.match(themePage, /aria-label=\{group\.label\}[\s\S]*onKeyDown=\{\(event\) => onSettingsRadioGroupKeyDown/);
    assert.match(themePage, /aria-label="界面密度"[\s\S]*onKeyDown=\{\(event\) => onSettingsRadioGroupKeyDown/);
    assert.match(themePage, /data-radio-value=\{option\.value\}[\s\S]*tabIndex=\{radioTabIndex\(option\.value, props\.themePref/);
    assert.match(themePage, /data-radio-value=\{palette\}[\s\S]*tabIndex=\{radioTabIndex\(palette, currentPalette, group\.palettes\)\}/);
    assert.match(themePage, /data-radio-value=\{option\.value\}[\s\S]*tabIndex=\{radioTabIndex\(option\.value, props\.density/);
    assert.match(segmentedBlock, /onKeyDown=\{\(event\) => onSettingsRadioGroupKeyDown\(event, values, props\.value, props\.onChange\)\}/);
    assert.match(segmentedBlock, /data-radio-value=\{value\}[\s\S]*tabIndex=\{radioTabIndex\(value, props\.value, values\)\}/);
  });

  it('keeps theme page copy Chinese-first and user-facing', async () => {
    const src = await readRepo('apps/desktop/src/renderer/settings/SettingsModal.tsx');
    const themePage = src.match(/function ThemeSettingsPage\([\s\S]*?function WebSearchSettingsPage/)?.[0] ?? '';
    const themeCopy = [
      src.match(/const THEME_OPTIONS[\s\S]*?\];/)?.[0] ?? '',
      src.match(/const DENSITY_OPTIONS[\s\S]*?\];/)?.[0] ?? '',
      src.match(/const PALETTE_HELP[\s\S]*?\};/)?.[0] ?? '',
      themePage.match(/<p className="settingsHelpText">[\s\S]*?<\/p>/)?.[0] ?? '',
    ].join('\n');

    assert.match(themeCopy, /匹配 macOS 当前浅色或深色偏好。/);
    assert.match(themeCopy, /专业编辑器风格。/);
    assert.match(themeCopy, /Maka 原本的紫色强调色/);
    assert.match(themeCopy, /湖蓝强调色，干净冷静/);
    assert.match(themeCopy, /保存在本地外观设置里下次启动延续/);
    assert.doesNotMatch(
      themeCopy,
      /Light\/Dark|settings\.json|safeStorage|API key|accent|IDE/,
      'Theme settings visible copy must not leak implementation or English UI terms',
    );
  });
});
