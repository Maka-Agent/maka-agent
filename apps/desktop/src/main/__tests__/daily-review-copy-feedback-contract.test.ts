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
    assert.match(main, /toastApi\.error\('复制失败'/);
  });

  it('appends Daily Review markdown to the composer instead of replacing the existing draft', async () => {
    const main = await readFile(resolve(REPO_ROOT, 'apps/desktop/src/renderer/main.tsx'), 'utf8');
    const handlerBlock = main.match(/onPasteTodayDailyReviewIntoComposer:\s*async \(\) => \{[\s\S]*?^\s*},/m)?.[0] ?? '';

    assert.match(handlerBlock, /formatDailyReviewMarkdown\(summary,\s*['"]今天['"]\)/);
    assert.match(handlerBlock, /composerRef\.current\?\.appendText\(markdown\)/);
    assert.match(handlerBlock, /toastApi\.success\(\s*['"]已追加今日回顾到输入框['"]/);
    assert.doesNotMatch(handlerBlock, /composerRef\.current\?\.setText\(markdown\)/);
  });
});
