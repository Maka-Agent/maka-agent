import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');

describe('Daily Review copy feedback contract', () => {
  it('lets the app shell own clipboard success and failure feedback', async () => {
    const ui = await readFile(resolve(REPO_ROOT, 'packages/ui/src/components.tsx'), 'utf8');
    const main = await readFile(resolve(REPO_ROOT, 'apps/desktop/src/renderer/main.tsx'), 'utf8');

    assert.match(ui, /onCopyDailyReviewMarkdown\?\(input:/);
    assert.match(ui, /onCopyMarkdown\?: \(input:/);
    assert.match(ui, /props\.onCopyMarkdown\(\{\s*markdown:\s*md,\s*label:\s*dayLabel,\s*summary\s*\}\)/);
    assert.match(main, /onCopyDailyReviewMarkdown=\{async \(\{ markdown, label, summary \}\) => \{/);
    assert.match(main, /await navigator\.clipboard\.writeText\(markdown\)/);
    assert.match(main, /toastApi\.success\(\s*`已复制\$\{label\}回顾`/);
    assert.match(main, /toastApi\.error\('复制失败', dailyReviewActionErrorMessage\(error, '剪贴板不可用或被系统拒绝'\)\)/);
  });

  it('appends Daily Review markdown to the composer instead of replacing the existing draft', async () => {
    const main = await readFile(resolve(REPO_ROOT, 'apps/desktop/src/renderer/main.tsx'), 'utf8');
    const handlerBlock = main.match(/onPasteTodayDailyReviewIntoComposer:\s*async \(\) => \{[\s\S]*?^\s*},/m)?.[0] ?? '';

    assert.match(handlerBlock, /formatDailyReviewMarkdown\(summary,\s*['"]今天['"]\)/);
    assert.match(handlerBlock, /composerRef\.current\?\.appendText\(markdown\)/);
    assert.match(handlerBlock, /toastApi\.success\(\s*['"]已追加今日回顾到输入框['"]/);
    assert.doesNotMatch(handlerBlock, /composerRef\.current\?\.setText\(markdown\)/);
  });

  it('lets the Daily Review main panel append the current range to the composer', async () => {
    const ui = await readFile(resolve(REPO_ROOT, 'packages/ui/src/components.tsx'), 'utf8');
    const main = await readFile(resolve(REPO_ROOT, 'apps/desktop/src/renderer/main.tsx'), 'utf8');
    const panelBlock = ui.match(/function DailyReviewPanel[\s\S]*?function PlanReminderPanel/)?.[0] ?? '';
    const mainPaneBlock = main.match(/onAppendDailyReviewMarkdown=\{\(\{ markdown, label, summary \}\) => \{[\s\S]*?^\s*}\}/m)?.[0] ?? '';

    assert.match(ui, /onAppendDailyReviewMarkdown\?: \(input:/);
    assert.match(panelBlock, /props\.onAppendMarkdown\?\.\(\{\s*markdown:\s*md,\s*label:\s*dayLabel,\s*summary\s*\}\)/);
    assert.match(panelBlock, />\s*粘到输入框\s*<\/button>/);
    assert.match(mainPaneBlock, /composerRef\.current\?\.appendText\(markdown\)/);
    assert.match(mainPaneBlock, /toastApi\.success\(\s*`已追加\$\{label\}回顾到输入框`/);
    assert.doesNotMatch(mainPaneBlock, /composerRef\.current\?\.setText\(markdown\)/);
  });

  it('scrubs Daily Review load and action failures before rendering them', async () => {
    const ui = await readFile(resolve(REPO_ROOT, 'packages/ui/src/components.tsx'), 'utf8');
    const main = await readFile(resolve(REPO_ROOT, 'apps/desktop/src/renderer/main.tsx'), 'utf8');
    const panelBlock = ui.match(/function DailyReviewPanel[\s\S]*?function dailyReviewPanelErrorMessage/)?.[0] ?? '';
    const helperBlock = main.match(/function dailyReviewActionErrorMessage\(error: unknown, fallback: string\): string \{[\s\S]*?\n\}/)?.[0] ?? '';

    assert.match(ui, /generalizedErrorMessageChinese/);
    assert.match(panelBlock, /setError\(dailyReviewPanelErrorMessage\(err\)\)/);
    assert.doesNotMatch(panelBlock, /err instanceof Error \? err\.message : ['"]加载失败['"]/);
    assert.match(ui, /function dailyReviewPanelErrorMessage\(error: unknown\): string \{[\s\S]*generalizedErrorMessageChinese\(error, '每日回顾暂时不可用，请稍后重试。'\)/);

    assert.match(helperBlock, /generalizedErrorMessageChinese\(error, fallback\)/);
    assert.match(main, /toastApi\.error\('保存失败', dailyReviewActionErrorMessage\(err, '保存每日回顾失败，请稍后重试。'\)\)/);
    assert.match(main, /dailyReviewActionErrorMessage\(err, '今日回顾暂时不可用，或剪贴板被系统拒绝。'\)/);
    assert.match(main, /dailyReviewActionErrorMessage\(err, '今日回顾暂时不可用，请稍后重试。'\)/);
    assert.doesNotMatch(main, /保存每日回顾失败'\)|剪贴板或数据不可用|加载今日回顾失败/);
  });
});
