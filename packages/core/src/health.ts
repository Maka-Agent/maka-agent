import type { CapabilityId, CapabilityReadinessState, CapabilitySnapshot } from './capabilities.js';
import type { LlmConnection } from './llm-connections.js';
import type { UsageLogRow } from './usage-stats/types.js';

export const HEALTH_SIGNAL_STATUSES = [
  'ok',
  'info',
  'warning',
  'error',
  'unknown',
] as const;
export type HealthSignalStatus = typeof HEALTH_SIGNAL_STATUSES[number];

export const HEALTH_SIGNAL_LAYERS = [
  'configuration',
  'validation',
  'permission',
  'feature',
  'action_approval',
  'memory_acceptance',
  'runtime_probe',
  'storage',
] as const;
export type HealthSignalLayer = typeof HEALTH_SIGNAL_LAYERS[number];

export type HealthSignalScope =
  | 'app'
  | 'llm_connection'
  | 'bot'
  | 'capability'
  | 'storage';

export type HealthSignalSource =
  | 'connection_test'
  | 'capability_snapshot'
  | 'permission_snapshot'
  | 'runtime_probe'
  | 'settings'
  | 'storage';

export interface HealthSignal {
  id: string;
  label: string;
  scope: HealthSignalScope;
  layer: HealthSignalLayer;
  status: HealthSignalStatus;
  source: HealthSignalSource;
  checkedAt: number;
  message: string;
  detail?: string;
  relatedCapabilityId?: CapabilityId;
  blocksSend?: boolean;
  blocksCapability?: boolean;
}

export interface HealthSnapshotSummary {
  ok: number;
  info: number;
  warning: number;
  error: number;
  unknown: number;
}

export interface HealthSnapshot {
  checkedAt: number;
  signals: HealthSignal[];
  summary: HealthSnapshotSummary;
}

export function isHealthSignalStatus(value: unknown): value is HealthSignalStatus {
  return typeof value === 'string' && (HEALTH_SIGNAL_STATUSES as readonly string[]).includes(value);
}

export function buildHealthSnapshot(checkedAt: number, signals: HealthSignal[]): HealthSnapshot {
  const summary: HealthSnapshotSummary = {
    ok: 0,
    info: 0,
    warning: 0,
    error: 0,
    unknown: 0,
  };
  for (const signal of signals) {
    summary[signal.status] += 1;
  }
  return { checkedAt, signals, summary };
}

export function healthSignalFromCapability(capability: CapabilitySnapshot): HealthSignal {
  const status = healthStatusFromCapabilityReadiness(capability.readiness);
  const layer = healthLayerFromCapability(capability);
  return {
    id: `capability:${capability.id}`,
    label: capability.label,
    scope: capability.id.startsWith('bot:') ? 'bot' : 'capability',
    layer,
    status,
    source: 'capability_snapshot',
    checkedAt: capability.updatedAt,
    message: capabilityMessage(capability.readiness),
    detail: capability.runtimeProbe.reason ?? capability.feature.reason ?? capability.configuration.reason,
    relatedCapabilityId: capability.id,
    blocksCapability: capability.readiness === 'denied' || capability.readiness === 'degraded',
  };
}

export function healthSignalFromConnection(connection: LlmConnection, checkedAt: number): HealthSignal {
  const configured = Boolean(connection.defaultModel);
  if (!connection.enabled) {
    return {
      id: `connection:${connection.slug}`,
      label: connection.name,
      scope: 'llm_connection',
      layer: 'configuration',
      status: 'info',
      source: 'settings',
      checkedAt,
      message: 'Connection is disabled.',
      blocksSend: false,
    };
  }

  if (!configured) {
    return {
      id: `connection:${connection.slug}`,
      label: connection.name,
      scope: 'llm_connection',
      layer: 'configuration',
      status: 'warning',
      source: 'settings',
      checkedAt,
      message: 'Connection is missing a default model.',
      blocksSend: true,
    };
  }

  if (connection.lastTestStatus === 'verified') {
    return {
      id: `connection:${connection.slug}`,
      label: connection.name,
      scope: 'llm_connection',
      layer: 'validation',
      status: 'ok',
      source: 'connection_test',
      checkedAt: timeFromIso(connection.lastTestAt) ?? checkedAt,
      message: 'Credential and endpoint validation passed.',
      detail: 'This is validation health only; it does not mean an agent send/stream/abort path is operational.',
      blocksSend: false,
    };
  }

  if (connection.lastTestStatus === 'needs_reauth') {
    return {
      id: `connection:${connection.slug}`,
      label: connection.name,
      scope: 'llm_connection',
      layer: 'validation',
      status: 'error',
      source: 'connection_test',
      checkedAt: timeFromIso(connection.lastTestAt) ?? checkedAt,
      message: 'Connection requires authentication repair.',
      detail: connection.lastTestMessage,
      blocksSend: true,
    };
  }

  if (connection.lastTestStatus === 'error') {
    return {
      id: `connection:${connection.slug}`,
      label: connection.name,
      scope: 'llm_connection',
      layer: 'validation',
      status: 'warning',
      source: 'connection_test',
      checkedAt: timeFromIso(connection.lastTestAt) ?? checkedAt,
      message: 'Last connection validation failed.',
      detail: connection.lastTestMessage,
      blocksSend: true,
    };
  }

  return {
    id: `connection:${connection.slug}`,
    label: connection.name,
    scope: 'llm_connection',
    layer: 'validation',
    status: 'unknown',
    source: 'connection_test',
    checkedAt,
    message: 'Connection has not been validated yet.',
    blocksSend: false,
  };
}

export function healthSignalFromConnectionRuntime(
  connection: LlmConnection,
  latestRuntimeProbe: UsageLogRow | undefined,
  checkedAt: number,
): HealthSignal | undefined {
  if (!connection.enabled || !connection.defaultModel) return undefined;

  if (!latestRuntimeProbe) {
    return {
      id: `connection:${connection.slug}:runtime`,
      label: `${connection.name} runtime`,
      scope: 'llm_connection',
      layer: 'runtime_probe',
      status: 'unknown',
      source: 'runtime_probe',
      checkedAt,
      message: 'No recorded agent send runtime probe yet.',
      detail: 'Credential validation is separate from live send/stream/abort health.',
      blocksSend: false,
    };
  }

  const status = runtimeStatusToHealth(latestRuntimeProbe.status);
  return {
    id: `connection:${connection.slug}:runtime`,
    label: `${connection.name} runtime`,
    scope: 'llm_connection',
    layer: 'runtime_probe',
    status,
    source: 'runtime_probe',
    checkedAt: latestRuntimeProbe.ts,
    message: runtimeProbeMessage(latestRuntimeProbe.status),
    detail: runtimeProbeDetail(latestRuntimeProbe),
    blocksSend: latestRuntimeProbe.status === 'error',
  };
}

function healthStatusFromCapabilityReadiness(readiness: CapabilityReadinessState): HealthSignalStatus {
  switch (readiness) {
    case 'enabled':
      return 'ok';
    case 'paused':
      return 'info';
    case 'not_configured':
      return 'warning';
    case 'degraded':
    case 'denied':
      return 'error';
  }
}

function healthLayerFromCapability(capability: CapabilitySnapshot): HealthSignalLayer {
  if (capability.readiness === 'paused') return 'feature';
  if (capability.readiness === 'degraded') return 'runtime_probe';

  const requiredPermissions = capability.osPermissions.filter((permission) => permission.required);
  if (requiredPermissions.some((permission) => permission.status === 'denied' || permission.status === 'unsupported')) {
    return 'permission';
  }
  if (requiredPermissions.some((permission) => permission.status === 'not_determined' || permission.status === 'unknown')) {
    return 'permission';
  }
  if (capability.configuration.state === 'missing') return 'configuration';
  if (capability.feature.state === 'not_available') return 'feature';
  if (capability.runtimeProbe.state === 'healthy') return 'runtime_probe';
  return 'feature';
}

function capabilityMessage(readiness: CapabilityReadinessState): string {
  switch (readiness) {
    case 'enabled':
      return 'Capability gates are satisfied.';
    case 'paused':
      return 'Capability is disabled or paused.';
    case 'not_configured':
      return 'Capability is not fully configured.';
    case 'denied':
      return 'Capability is blocked by a required permission.';
    case 'degraded':
      return 'Capability runtime probe is degraded.';
  }
}

function timeFromIso(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function runtimeStatusToHealth(status: UsageLogRow['status']): HealthSignalStatus {
  switch (status) {
    case 'success':
      return 'ok';
    case 'aborted':
      return 'info';
    case 'error':
      return 'warning';
  }
}

function runtimeProbeMessage(status: UsageLogRow['status']): string {
  switch (status) {
    case 'success':
      return 'Last recorded agent send completed.';
    case 'aborted':
      return 'Last recorded agent send was stopped by the user.';
    case 'error':
      return 'Last recorded agent send failed.';
  }
}

function runtimeProbeDetail(row: UsageLogRow): string {
  const parts = [
    `model=${row.modelId}`,
    `latency=${row.latencyMs}ms`,
  ];
  if (row.errorClass) parts.push(`errorClass=${row.errorClass}`);
  return parts.join(' · ');
}
