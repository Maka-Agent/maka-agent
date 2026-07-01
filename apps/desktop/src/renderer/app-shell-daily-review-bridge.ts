import type { DailyReviewConfig, DailyReviewMode, LlmConnection } from '@maka/core';
import {
  buildDailyReviewRunModelOptions,
  DAILY_REVIEW_CONFIG_MODEL_VALUE,
} from './daily-review-actions';

export function createAppShellDailyReviewBridge(connections: readonly LlmConnection[]) {
  return {
    modelOptions: buildDailyReviewRunModelOptions(connections),
    async fetchDay(offsetDays: number, daySpan?: number) {
      const result = await window.maka.dailyReview.day(offsetDays, daySpan);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    runOnce(input: { mode: DailyReviewMode; modelKey?: string }) {
      const runOnce = window.maka.dailyReview.runOnce;
      if (!runOnce) throw new Error('每日回顾生成暂不可用');
      const modelKey = input.modelKey === DAILY_REVIEW_CONFIG_MODEL_VALUE ? undefined : input.modelKey;
      return runOnce({ ...input, modelKey });
    },
    listArchives() {
      const listArchives = window.maka.dailyReview.listArchives;
      if (!listArchives) throw new Error('每日回顾历史暂不可用');
      return listArchives();
    },
    async getArchive(archiveId: string) {
      const getArchive = window.maka.dailyReview.getArchive;
      if (!getArchive) throw new Error('每日回顾历史暂不可用');
      const archive = await getArchive(archiveId);
      if (!archive) throw new Error('找不到每日回顾报告');
      return archive;
    },
    deleteArchive(archiveId: string) {
      const deleteArchive = window.maka.dailyReview.deleteArchive;
      if (!deleteArchive) throw new Error('每日回顾历史暂不可用');
      return deleteArchive(archiveId);
    },
    fetchConfig() {
      const getConfig = window.maka.dailyReview.getConfig;
      if (!getConfig) throw new Error('每日回顾设置暂不可用');
      return getConfig();
    },
    updateConfig(patch: Partial<DailyReviewConfig>) {
      const setConfig = window.maka.dailyReview.setConfig;
      if (!setConfig) throw new Error('每日回顾设置暂不可用');
      return setConfig(patch);
    },
  };
}
