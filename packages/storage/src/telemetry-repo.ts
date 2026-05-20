import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  PricingConfig,
  UsageBucket,
  UsageGroupBy,
  UsageLogRow,
  UsageQuery,
  UsageSummaryV2,
  LlmCallRecord,
  ToolInvocationRecord,
} from '@maka/core/usage-stats/types';

type PersistedLlmCallRecord = LlmCallRecord & {
  id: string;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  date: string;
  ts: number;
};

type PersistedToolInvocationRecord = ToolInvocationRecord & {
  id: string;
  argsSummary?: string;
  bytesIn: number;
  bytesOut: number;
  date: string;
  ts: number;
};

interface TelemetryFile {
  usageRecords: PersistedLlmCallRecord[];
  toolInvocations: PersistedToolInvocationRecord[];
  pricingOverrides: PricingConfig[];
}

export interface TelemetryRepo {
  insertLlmCall(record: PersistedLlmCallRecord): void;
  insertToolInvocation(record: PersistedToolInvocationRecord): void;
  summary(query: UsageQuery): UsageSummaryV2;
  buckets(query: UsageQuery, groupBy: UsageGroupBy): UsageBucket[];
  logs(query: UsageQuery, offset?: number, limit?: number): { rows: UsageLogRow[]; total: number };
  listPricingOverrides(): PricingConfig[];
  upsertPricing(pricing: PricingConfig): Promise<void>;
  deletePricing(modelKey: string): Promise<void>;
  load(): Promise<void>;
}

export function createTelemetryRepo(workspaceRoot: string): TelemetryRepo {
  return new FileTelemetryRepo(workspaceRoot);
}

class FileTelemetryRepo implements TelemetryRepo {
  private readonly path: string;
  private file: TelemetryFile = emptyFile();
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(workspaceRoot: string) {
    this.path = join(workspaceRoot, 'telemetry.json');
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const text = await readFile(this.path, 'utf8');
      this.file = normalizeFile(JSON.parse(text));
    } catch {
      this.file = emptyFile();
      await this.write();
    }
    this.loaded = true;
  }

  insertLlmCall(record: PersistedLlmCallRecord): void {
    this.file.usageRecords = upsertById(this.file.usageRecords, record);
    void this.enqueueWrite();
  }

  insertToolInvocation(record: PersistedToolInvocationRecord): void {
    this.file.toolInvocations = upsertById(this.file.toolInvocations, record);
    void this.enqueueWrite();
  }

  summary(query: UsageQuery): UsageSummaryV2 {
    const { from, to } = resolveRange(query.range);
    const rows = this.filteredUsageRows(query, from, to);
    const input = sum(rows.map((row) => row.inputTokens));
    const output = sum(rows.map((row) => row.outputTokens));
    const cacheRead = sum(rows.map((row) => row.cachedInputTokens));
    const cacheWrite = sum(rows.map((row) => row.cacheWriteInputTokens));
    const reasoning = sum(rows.map((row) => row.reasoningTokens));
    return {
      range: { from, to },
      totalRequests: rows.length,
      totalCostUsd: sum(rows.map((row) => row.costUsd)),
      totalTokens: {
        input,
        output,
        cacheRead,
        cacheWrite,
        reasoning,
        total: sum(rows.map((row) => row.totalTokens)),
      },
      cacheHitRequests: rows.filter((row) => row.cachedInputTokens > 0).length,
      cacheCreateRequests: rows.filter((row) => row.cacheWriteInputTokens > 0).length,
      errorRequests: rows.filter((row) => row.status === 'error').length,
    };
  }

  buckets(query: UsageQuery, groupBy: UsageGroupBy): UsageBucket[] {
    const { from, to } = resolveRange(query.range);
    if (groupBy === 'tool') return toolBuckets(this.filteredToolRows(query, from, to));
    const rows = this.filteredUsageRows(query, from, to);
    const groups = new Map<string, PersistedLlmCallRecord[]>();
    for (const row of rows) {
      const key = bucketKey(row, groupBy);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .map(([key, groupRows]) => usageBucket(key, groupRows))
      .sort((a, b) => b.requests - a.requests);
  }

  logs(query: UsageQuery, offset = 0, limit = 100): { rows: UsageLogRow[]; total: number } {
    const { from, to } = resolveRange(query.range);
    const rows = this.filteredUsageRows(query, from, to)
      .sort((a, b) => b.ts - a.ts)
      .map((row) => ({
        id: row.id,
        ts: row.ts,
        providerId: row.providerId,
        modelId: row.modelId,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cachedInputTokens,
        cacheWriteTokens: row.cacheWriteInputTokens,
        reasoningTokens: row.reasoningTokens,
        totalTokens: row.totalTokens,
        costUsd: row.costUsd,
        latencyMs: row.latencyMs,
        status: row.status,
        ...(row.errorClass ? { errorClass: row.errorClass } : {}),
        ...(row.sessionId ? { sessionId: row.sessionId } : {}),
        ...(row.turnId ? { turnId: row.turnId } : {}),
      } satisfies UsageLogRow));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }

  listPricingOverrides(): PricingConfig[] {
    return [...this.file.pricingOverrides];
  }

  async upsertPricing(pricing: PricingConfig): Promise<void> {
    this.file.pricingOverrides = [
      ...this.file.pricingOverrides.filter((item) => item.modelKey !== pricing.modelKey),
      pricing,
    ].sort((a, b) => a.modelKey.localeCompare(b.modelKey));
    await this.enqueueWrite();
  }

  async deletePricing(modelKey: string): Promise<void> {
    this.file.pricingOverrides = this.file.pricingOverrides.filter((item) => item.modelKey !== modelKey);
    await this.enqueueWrite();
  }

  private filteredUsageRows(query: UsageQuery, from: number, to: number): PersistedLlmCallRecord[] {
    return this.file.usageRecords.filter((row) => {
      if (row.ts < from || row.ts > to) return false;
      if (query.providerId && row.providerId !== query.providerId) return false;
      if (query.modelId && row.modelId !== query.modelId) return false;
      if (query.status && query.status !== 'all' && row.status !== query.status) return false;
      return true;
    });
  }

  private filteredToolRows(query: UsageQuery, from: number, to: number): PersistedToolInvocationRecord[] {
    return this.file.toolInvocations.filter((row) => {
      if (row.ts < from || row.ts > to) return false;
      if (query.toolName && row.toolName !== query.toolName) return false;
      if (query.status && query.status !== 'all' && row.status !== query.status) return false;
      return true;
    });
  }

  private enqueueWrite(): Promise<void> {
    const next = this.queue.then(() => this.write(), () => this.write());
    this.queue = next.catch(() => {});
    return next;
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.file, null, 2) + '\n', 'utf8');
    await rename(tempPath, this.path);
  }
}

function emptyFile(): TelemetryFile {
  return { usageRecords: [], toolInvocations: [], pricingOverrides: [] };
}

function normalizeFile(input: unknown): TelemetryFile {
  if (!input || typeof input !== 'object') return emptyFile();
  const value = input as Partial<TelemetryFile>;
  return {
    usageRecords: Array.isArray(value.usageRecords) ? value.usageRecords : [],
    toolInvocations: Array.isArray(value.toolInvocations) ? value.toolInvocations : [],
    pricingOverrides: Array.isArray(value.pricingOverrides) ? value.pricingOverrides : [],
  };
}

function upsertById<T extends { id: string }>(rows: T[], row: T): T[] {
  return [...rows.filter((current) => current.id !== row.id), row];
}

export function resolveRange(range: UsageQuery['range']): { from: number; to: number } {
  if (typeof range === 'object') return range;
  const now = Date.now();
  switch (range) {
    case '24h': return { from: now - 24 * 60 * 60 * 1000, to: now };
    case '7d': return { from: now - 7 * 24 * 60 * 60 * 1000, to: now };
    case '30d': return { from: now - 30 * 24 * 60 * 60 * 1000, to: now };
    case 'all': return { from: 0, to: now };
  }
}

function bucketKey(row: PersistedLlmCallRecord, groupBy: UsageGroupBy): string {
  switch (groupBy) {
    case 'provider': return row.providerId;
    case 'model': return `${row.providerId}:${row.modelId}`;
    case 'day': return row.date;
    case 'hour': return String(Math.floor(row.ts / (60 * 60 * 1000)));
    case 'tool': return '';
  }
}

function usageBucket(key: string, rows: PersistedLlmCallRecord[]): UsageBucket {
  const errorCount = rows.filter((row) => row.status === 'error').length;
  return {
    key,
    label: key,
    requests: rows.length,
    inputTokens: sum(rows.map((row) => row.inputTokens)),
    outputTokens: sum(rows.map((row) => row.outputTokens)),
    cacheReadTokens: sum(rows.map((row) => row.cachedInputTokens)),
    cacheWriteTokens: sum(rows.map((row) => row.cacheWriteInputTokens)),
    reasoningTokens: sum(rows.map((row) => row.reasoningTokens)),
    totalTokens: sum(rows.map((row) => row.totalTokens)),
    costUsd: sum(rows.map((row) => row.costUsd)),
    avgLatencyMs: rows.length ? Math.round(sum(rows.map((row) => row.latencyMs)) / rows.length) : 0,
    errorRate: rows.length ? errorCount / rows.length : 0,
  };
}

function toolBuckets(rows: PersistedToolInvocationRecord[]): UsageBucket[] {
  const groups = new Map<string, PersistedToolInvocationRecord[]>();
  for (const row of rows) {
    const list = groups.get(row.toolName) ?? [];
    list.push(row);
    groups.set(row.toolName, list);
  }
  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const errorCount = groupRows.filter((row) => row.status === 'error').length;
      const inputBytes = sum(groupRows.map((row) => row.bytesIn));
      const outputBytes = sum(groupRows.map((row) => row.bytesOut));
      return {
        key,
        label: key,
        requests: groupRows.length,
        inputTokens: inputBytes,
        outputTokens: outputBytes,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: inputBytes + outputBytes,
        costUsd: 0,
        avgLatencyMs: groupRows.length ? Math.round(sum(groupRows.map((row) => row.durationMs)) / groupRows.length) : 0,
        errorRate: groupRows.length ? errorCount / groupRows.length : 0,
      } satisfies UsageBucket;
    })
    .sort((a, b) => b.requests - a.requests);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
