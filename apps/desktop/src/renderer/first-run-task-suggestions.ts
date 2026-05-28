/**
 * Concrete first-run task prompts inspired by PawWork's home
 * suggestion rows (`packages/app/src/components/home/home-suggestions-*`).
 *
 * borrow
 * - Show short, task-shaped rows near the first composer.
 * - Clicking a row pre-fills a fuller prompt so users see what a
 *   good desktop-work request looks like before they send it.
 *
 * diverge
 * - No dismissal / persistence yet. Maka only shows this surface while
 *   `ready_empty`, and it disappears naturally after the first session.
 * - Prompts are conservative: they ask the agent to inspect and propose
 *   before mutating files.
 */

export type FirstRunTaskSuggestionId =
  | 'workspace-map'
  | 'file-organize'
  | 'web-research';

export interface FirstRunTaskSuggestion {
  id: FirstRunTaskSuggestionId;
  label: string;
  prompt: string;
}

export const FIRST_RUN_TASK_SUGGESTIONS: readonly FirstRunTaskSuggestion[] = [
  {
    id: 'workspace-map',
    label: '读一下这个项目',
    prompt:
      '帮我读一下这个项目的目录结构，先找出入口、核心模块和测试位置，再用简短列表告诉我如果要继续开发应该从哪里开始。',
  },
  {
    id: 'file-organize',
    label: '整理一个文件夹',
    prompt:
      '帮我整理当前工作区里的文件：先列出你看到的文件类型和建议的目录结构，不要直接移动或删除文件，等我确认后再执行。',
  },
  {
    id: 'web-research',
    label: '联网研究一个主题',
    prompt:
      '帮我联网研究一个主题：先问我主题是什么，然后用已配置的联网搜索找资料，最后给我来源、关键结论和还需要核实的点。',
  },
] as const;

