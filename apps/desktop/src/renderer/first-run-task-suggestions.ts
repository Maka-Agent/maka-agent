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
 * - Dismissal is explicit and reversible via the onboarding milestone
 *   store. Only the suggestion id is persisted; prompt text is never
 *   stored in settings.
 * - Prompts are conservative: they ask the agent to inspect and propose
 *   before mutating files.
 */

import type { OnboardingMilestoneId, QuickChatMode } from '@maka/core';

export type FirstRunTaskSuggestionId =
  | 'workspace-map'
  | 'deep-research'
  | 'file-organize'
  | 'web-research';

export interface FirstRunTaskSuggestion {
  id: FirstRunTaskSuggestionId;
  label: string;
  prompt: string;
  mode?: QuickChatMode;
}

export const FIRST_RUN_TASK_SUGGESTIONS: readonly FirstRunTaskSuggestion[] = [
  {
    id: 'workspace-map',
    label: '读一下这个项目',
    mode: 'deep_research',
    prompt:
      '进入深度研究模式，只读梳理这个项目的目录结构：先找出入口、核心模块和测试位置，再用简短列表告诉我如果要继续开发应该从哪里开始。不要修改文件。',
  },
  {
    id: 'deep-research',
    label: '深度研究一个项目',
    mode: 'deep_research',
    prompt:
      '进入深度研究模式，只读分析当前项目：先用目录、配置、入口文件、测试和关键模块建立架构图，再列出可以直接改进的功能点。不要修改文件，输出 borrow / diverge / risk / gate。',
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

export const FIRST_RUN_TASK_SUGGESTION_MILESTONES: Record<
  FirstRunTaskSuggestionId,
  OnboardingMilestoneId
> = {
  'workspace-map': 'first_run_suggestion_workspace_map',
  'deep-research': 'first_run_suggestion_deep_research',
  'file-organize': 'first_run_suggestion_file_organize',
  'web-research': 'first_run_suggestion_web_research',
};
