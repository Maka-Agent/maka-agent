export type TimeRange =
  | '24h'
  | '7d'
  | '30d'
  | 'all'
  | { from: number; to: number };

export type UsageGroupBy = 'provider' | 'model' | 'tool' | 'day' | 'hour';

export interface UsageQuery {
  range: TimeRange;
  providerId?: string;
  modelId?: string;
  toolName?: string;
  status?: 'success' | 'error' | 'aborted' | 'all';
}

export interface UsageSummaryV2 {
  range: { from: number; to: number };
  totalRequests: number;
  totalCostUsd: number;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    total: number;
  };
  cacheHitRequests: number;
  cacheCreateRequests: number;
  errorRequests: number;
}

export interface UsageBucket {
  key: string;
  label: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface UsageLogRow {
  id: string;
  ts: number;
  providerId: string;
  modelId: string;
  toolName?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'success' | 'error' | 'aborted';
  errorClass?: string;
  sessionId?: string;
  turnId?: string;
}

export interface PricingConfig {
  modelKey: string;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cacheReadUsdPer1M?: number;
  cacheWriteUsdPer1M?: number;
}

export interface LlmCallRecord {
  sessionId?: string;
  turnId?: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  status: 'success' | 'error' | 'aborted';
  errorClass?: string;
  startedAt: number;
}

export interface ToolInvocationRecord {
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
  toolName: string;
  providerId?: string;
  modelId?: string;
  durationMs: number;
  status: 'success' | 'error' | 'aborted';
  errorClass?: string;
  argsSummary?: string;
  bytesIn?: number;
  bytesOut?: number;
  startedAt: number;
}
