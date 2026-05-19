import {
  PROVIDER_DEFAULTS,
  effectiveBaseUrl,
  type LlmConnection,
  type ModelInfo,
} from '@maka/core/llm-connections';

export async function fetchProviderModels(
  connection: LlmConnection,
  apiKey: string,
): Promise<ModelInfo[]> {
  const baseUrl = effectiveBaseUrl(connection);
  const auth = PROVIDER_DEFAULTS[connection.providerType].authKind;
  try {
    if (connection.providerType === 'ollama') {
      const r = await fetch(`${ollamaRoot(baseUrl)}/api/tags`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { models?: Array<{ name?: string }> };
      return (data.models ?? []).flatMap((model) => model.name ? [{ id: model.name }] : []);
    }

    switch (PROVIDER_DEFAULTS[connection.providerType].protocol) {
      case 'anthropic': {
        const r = await fetch(`${stripTrailing(baseUrl)}/v1/models`, {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json() as { data?: Array<{ id?: string }> };
        return (data.data ?? []).flatMap((model) => model.id ? [{ id: model.id }] : []);
      }
      case 'openai': {
        const r = await fetch(`${stripTrailing(baseUrl)}/models`, {
          headers: auth === 'none' ? {} : { authorization: `Bearer ${apiKey}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json() as { data?: Array<{ id?: string }> };
        return (data.data ?? []).flatMap((model) => model.id ? [{ id: model.id }] : []);
      }
      case 'google': {
        const r = await fetch(
          `${stripTrailing(baseUrl)}/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json() as { models?: Array<{ name?: string }> };
        return (data.models ?? []).flatMap((model) => {
          const id = model.name?.split('/').pop();
          return id ? [{ id }] : [];
        });
      }
    }
  } catch {
    return PROVIDER_DEFAULTS[connection.providerType].fallbackModels.map((id) => ({ id }));
  }
}

function stripTrailing(u: string): string {
  return u.replace(/\/+$/, '');
}

function ollamaRoot(baseUrl: string): string {
  return stripTrailing(baseUrl).replace(/\/v1$/, '');
}
