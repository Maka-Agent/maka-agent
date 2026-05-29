import {
  PROVIDER_DEFAULTS,
  type ConnectionAuth,
  type ConnectionLastTestStatus,
  type LlmConnection,
  type ProviderType,
} from './llm-connections.js';

export const PROVIDER_AUTH_SETUP_MODES = [
  'api_key',
  'oauth_preview',
  'none',
] as const;
export type ProviderAuthSetupMode = typeof PROVIDER_AUTH_SETUP_MODES[number];

export const PROVIDER_AUTH_STATES = [
  'disabled',
  'not_configured',
  'configured',
  'validated',
  'needs_reauth',
  'error',
  'preview_only',
] as const;
export type ProviderAuthState = typeof PROVIDER_AUTH_STATES[number];

export const PROVIDER_AUTH_ACTIONS = [
  'save_secret',
  'test_credentials',
  'fetch_models',
  'start_oauth',
  'refresh_oauth',
  'revoke_auth',
] as const;
export type ProviderAuthAction = typeof PROVIDER_AUTH_ACTIONS[number];

export type ProviderAuthActionAvailability = 'available' | 'preview_only' | 'hidden';

export interface ProviderAuthContractInput {
  providerType: ProviderType;
  enabled?: boolean;
  hasSecret?: boolean;
  lastTestStatus?: ConnectionLastTestStatus;
}

export interface ProviderAuthContract {
  providerType: ProviderType;
  setupMode: ProviderAuthSetupMode;
  state: ProviderAuthState;
  /**
   * Credential validation only. This is intentionally separate from
   * HealthSignal runtime probes and must not be rendered as "agent is
   * operational".
   */
  validationStatus: ConnectionLastTestStatus | 'not_run' | 'not_required';
  requiresSecret: boolean;
  sendMayUseWithoutSecret: boolean;
  actionAvailability: Record<ProviderAuthAction, ProviderAuthActionAvailability>;
  copy: {
    label: string;
    detail: string;
  };
}

export function deriveProviderAuthContract(input: ProviderAuthContractInput): ProviderAuthContract {
  const defaults = PROVIDER_DEFAULTS[input.providerType];
  const enabled = input.enabled ?? true;
  const hasSecret = Boolean(input.hasSecret);
  const actionAvailability = hiddenActions();

  if (!enabled) {
    return {
      providerType: input.providerType,
      setupMode: setupModeForAuthKind(defaults.authKind),
      state: 'disabled',
      validationStatus: input.lastTestStatus ?? (defaults.authKind === 'none' ? 'not_required' : 'not_run'),
      requiresSecret: defaults.authKind !== 'none',
      sendMayUseWithoutSecret: defaults.authKind === 'none',
      actionAvailability,
      copy: {
        label: `${defaults.label} 已关闭`,
        detail: '连接被显式关闭；不会作为发送默认连接，也不会触发凭据测试。',
      },
    };
  }

  if (defaults.authKind === 'oauth_token') {
    return {
      providerType: input.providerType,
      setupMode: 'oauth_preview',
      state: 'preview_only',
      validationStatus: 'not_run',
      requiresSecret: true,
      sendMayUseWithoutSecret: false,
      actionAvailability: {
        ...actionAvailability,
        start_oauth: 'preview_only',
        refresh_oauth: 'preview_only',
        revoke_auth: 'preview_only',
      },
      copy: {
        label: `${defaults.label} 账号登录预览`,
        detail: '当前仅展示账号登录状态入口；API key 连接仍是聊天模型的可用路径。',
      },
    };
  }

  if (defaults.authKind === 'none') {
    return {
      providerType: input.providerType,
      setupMode: 'none',
      state: 'configured',
      validationStatus: 'not_required',
      requiresSecret: false,
      sendMayUseWithoutSecret: true,
      actionAvailability: {
        ...actionAvailability,
        test_credentials: 'available',
        fetch_models: 'available',
      },
      copy: {
        label: `${defaults.label} 不需要凭据`,
        detail: '此 provider 不需要 API key；可用性仍取决于本地服务和模型列表。',
      },
    };
  }

  const validationStatus = input.lastTestStatus ?? 'not_run';
  const state: ProviderAuthState = authStateFromSecretAndTest(hasSecret, input.lastTestStatus);
  return {
    providerType: input.providerType,
    setupMode: 'api_key',
    state,
    validationStatus,
    requiresSecret: true,
    sendMayUseWithoutSecret: false,
    actionAvailability: {
      ...actionAvailability,
      save_secret: 'available',
      test_credentials: hasSecret ? 'available' : 'hidden',
      fetch_models: hasSecret ? 'available' : 'hidden',
      revoke_auth: hasSecret ? 'available' : 'hidden',
    },
    copy: copyForApiKey(defaults.label, state),
  };
}

export function deriveProviderAuthContractFromConnection(
  connection: Pick<LlmConnection, 'providerType' | 'enabled' | 'lastTestStatus'>,
  hasSecret: boolean,
): ProviderAuthContract {
  return deriveProviderAuthContract({
    providerType: connection.providerType,
    enabled: connection.enabled,
    hasSecret,
    lastTestStatus: connection.lastTestStatus,
  });
}

export function isProviderAuthState(value: unknown): value is ProviderAuthState {
  return typeof value === 'string' && (PROVIDER_AUTH_STATES as readonly string[]).includes(value);
}

function authStateFromSecretAndTest(
  hasSecret: boolean,
  lastTestStatus: ConnectionLastTestStatus | undefined,
): ProviderAuthState {
  if (!hasSecret) return 'not_configured';
  if (lastTestStatus === 'verified') return 'validated';
  if (lastTestStatus === 'needs_reauth') return 'needs_reauth';
  if (lastTestStatus === 'error') return 'error';
  return 'configured';
}

function hiddenActions(): Record<ProviderAuthAction, ProviderAuthActionAvailability> {
  return {
    save_secret: 'hidden',
    test_credentials: 'hidden',
    fetch_models: 'hidden',
    start_oauth: 'hidden',
    refresh_oauth: 'hidden',
    revoke_auth: 'hidden',
  };
}

function setupModeForAuthKind(authKind: ConnectionAuth['kind']): ProviderAuthSetupMode {
  if (authKind === 'none') return 'none';
  if (authKind === 'oauth_token') return 'oauth_preview';
  return 'api_key';
}

function copyForApiKey(label: string, state: ProviderAuthState): ProviderAuthContract['copy'] {
  switch (state) {
    case 'not_configured':
      return {
        label: `${label} 等待 API key`,
        detail: '保存凭据后才能测试连接或拉取模型列表。',
      };
    case 'validated':
      return {
        label: `${label} 凭据验证通过`,
        detail: '这只代表凭据和端点验证通过，不代表 agent 发送、流式、中断路径已经运行可用。',
      };
    case 'needs_reauth':
      return {
        label: `${label} 需要重新授权`,
        detail: '上次凭据测试显示鉴权失败；请替换凭据后重新测试。',
      };
    case 'error':
      return {
        label: `${label} 凭据测试失败`,
        detail: '上次测试未通过；详情必须使用概括后的错误信息，不展示 provider 原始响应。',
      };
    case 'configured':
      return {
        label: `${label} 已保存凭据`,
        detail: '凭据已保存，等待验证；测试通过前不要把它展示成运行可用。',
      };
    case 'disabled':
    case 'preview_only':
      return {
        label,
        detail: '当前状态不走 API key 凭据流程。',
      };
  }
}
