import { describe, test } from 'node:test';
import { expect } from '../test-helpers.js';
import {
  buildHealthSnapshot,
  healthSignalFromCapability,
  healthSignalFromConnection,
  healthSignalFromConnectionRuntime,
  isHealthSignalStatus,
  type HealthSignal,
} from '../health.js';
import type { CapabilitySnapshot } from '../capabilities.js';
import type { LlmConnection } from '../llm-connections.js';

describe('HealthSignal contract', () => {
  test('locks health status guard and summary counts', () => {
    expect(isHealthSignalStatus('ok')).toBe(true);
    expect(isHealthSignalStatus('operational')).toBe(false);

    const snapshot = buildHealthSnapshot(10, [
      signal('a', 'ok'),
      signal('b', 'warning'),
      signal('c', 'warning'),
      signal('d', 'unknown'),
    ]);

    expect(snapshot.summary).toEqual({
      ok: 1,
      info: 0,
      warning: 2,
      error: 0,
      unknown: 1,
    });
  });

  test('verified LLM connection is validation health, not runtime operational', () => {
    const result = healthSignalFromConnection(connection({
      lastTestStatus: 'verified',
      lastTestAt: '2026-05-22T07:30:00.000Z',
    }), 20);

    expect(result.status).toBe('ok');
    expect(result.layer).toBe('validation');
    expect(result.source).toBe('connection_test');
    expect(result.message).toBe('Credential and endpoint validation passed.');
    expect(result.detail).toContain('does not mean an agent send/stream/abort path is operational');
  });

  test('LLM runtime probe is separate from credential validation', () => {
    const unknown = healthSignalFromConnectionRuntime(connection({ lastTestStatus: 'verified' }), undefined, 30);
    expect(unknown?.status).toBe('unknown');
    expect(unknown?.layer).toBe('runtime_probe');
    expect(unknown?.source).toBe('runtime_probe');
    expect(unknown?.message).toContain('No recorded agent send');

    const ok = healthSignalFromConnectionRuntime(connection({ lastTestStatus: 'verified' }), {
      id: 'usage_turn_1',
      ts: 40,
      connectionSlug: 'zai',
      providerId: 'zai-coding-plan',
      modelId: 'glm-4.7',
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 3,
      costUsd: 0,
      latencyMs: 250,
      status: 'success',
    }, 30);
    expect(ok?.status).toBe('ok');
    expect(ok?.checkedAt).toBe(40);
    expect(ok?.detail).toContain('model=glm-4.7');

    const failed = healthSignalFromConnectionRuntime(connection({ lastTestStatus: 'verified' }), {
      id: 'usage_turn_2',
      ts: 50,
      connectionSlug: 'zai',
      providerId: 'zai-coding-plan',
      modelId: 'glm-4.7',
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 1,
      costUsd: 0,
      latencyMs: 90,
      status: 'error',
      errorClass: 'auth',
    }, 30);
    expect(failed?.status).toBe('warning');
    expect(failed?.blocksSend).toBe(true);
    expect(failed?.detail).toContain('errorClass=auth');
  });

  test('disabled or unconfigured connections do not emit runtime probe health', () => {
    expect(healthSignalFromConnectionRuntime(connection({ enabled: false }), undefined, 30)).toBe(undefined);
    expect(healthSignalFromConnectionRuntime(connection({ defaultModel: '' }), undefined, 30)).toBe(undefined);
  });

  test('missing default model blocks send at configuration layer', () => {
    const result = healthSignalFromConnection(connection({ defaultModel: '' }), 20);

    expect(result.status).toBe('warning');
    expect(result.layer).toBe('configuration');
    expect(result.blocksSend).toBe(true);
  });

  test('capability denied and degraded remain distinct health errors', () => {
    const denied = healthSignalFromCapability(capability('computer_use', 'denied', {
      osPermissions: [{ id: 'accessibility', required: true, status: 'denied' }],
    }));
    const degraded = healthSignalFromCapability(capability('bot:telegram', 'degraded'));

    expect(denied.status).toBe('error');
    expect(denied.layer).toBe('permission');
    expect(denied.message).toBe('Capability is blocked by a required permission.');
    expect(degraded.status).toBe('error');
    expect(degraded.layer).toBe('runtime_probe');
    expect(degraded.message).toBe('Capability runtime probe is degraded.');
    expect(degraded.scope).toBe('bot');
  });
});

function signal(id: string, status: HealthSignal['status']): HealthSignal {
  return {
    id,
    label: id,
    scope: 'app',
    layer: 'runtime_probe',
    status,
    source: 'runtime_probe',
    checkedAt: 1,
    message: id,
  };
}

function connection(patch: Partial<LlmConnection>): LlmConnection {
  return {
    slug: 'zai',
    name: 'Z.ai',
    providerType: 'zai-coding-plan',
    defaultModel: 'glm-4.7',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function capability(
  id: CapabilitySnapshot['id'],
  readiness: CapabilitySnapshot['readiness'],
  patch: Partial<CapabilitySnapshot> = {},
): CapabilitySnapshot {
  return {
    id,
    label: id,
    readiness,
    feature: { state: 'enabled', source: 'settings' },
    configuration: { state: 'present', source: 'settings' },
    osPermissions: [],
    actionApproval: { state: 'required_per_action', source: 'capability_policy' },
    memoryAcceptance: { state: 'not_applicable', source: 'not_applicable' },
    runtimeProbe: { state: readiness === 'degraded' ? 'degraded' : 'not_run', source: 'runtime_probe' },
    canRevoke: false,
    canPause: false,
    auditEvents: [],
    updatedAt: 1,
    ...patch,
  };
}
