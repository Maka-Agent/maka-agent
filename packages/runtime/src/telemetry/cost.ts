import type { PricingConfig } from '@maka/core/usage-stats/types';

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

export function computeCost(usage: CostInput, pricing: PricingConfig | null): CostBreakdown {
  if (!pricing) {
    return { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0 };
  }
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputUsdPer1M;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputUsdPer1M;
  const cacheReadCost = pricing.cacheReadUsdPer1M && usage.cachedInputTokens
    ? (usage.cachedInputTokens / 1_000_000) * pricing.cacheReadUsdPer1M
    : 0;
  const cacheWriteCost = pricing.cacheWriteUsdPer1M && usage.cacheWriteInputTokens
    ? (usage.cacheWriteInputTokens / 1_000_000) * pricing.cacheWriteUsdPer1M
    : 0;
  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}
