import {
  PROVIDER_DEFAULTS,
  effectiveBaseUrl,
  type ConnectionTestResult,
  type LlmConnection,
} from '@maka/core/llm-connections';

export async function testConnection(
  connection: LlmConnection,
  apiKey: string,
  model?: string,
): Promise<ConnectionTestResult> {
  const t0 = Date.now();
  const baseUrl = effectiveBaseUrl(connection);
  const auth = PROVIDER_DEFAULTS[connection.providerType].authKind;
  const secret = auth === 'none' ? '' : apiKey;
  const testModel =
    model ||
    connection.defaultModel ||
    PROVIDER_DEFAULTS[connection.providerType].fallbackModels[0];

  if (!testModel) {
    return { ok: false, errorMessage: 'No model to test' };
  }

  try {
    switch (PROVIDER_DEFAULTS[connection.providerType].protocol) {
      case 'anthropic':
        return await probeAnthropic(baseUrl, secret, testModel, t0);
      case 'openai':
        return await probeOpenAI(baseUrl, secret, testModel, t0);
      case 'google':
        return await probeGoogle(baseUrl, secret, testModel, t0);
    }
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - t0,
    };
  }
}

async function probeAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  t0: number,
): Promise<ConnectionTestResult> {
  const r = await fetch(`${stripTrailing(baseUrl)}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Hi' }],
    }),
  });
  if (!r.ok) return httpFailure(r, t0);
  return { ok: true, latencyMs: Date.now() - t0, modelTested: model };
}

async function probeOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  t0: number,
): Promise<ConnectionTestResult> {
  const r = await fetch(`${stripTrailing(baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Hi' }],
    }),
  });
  if (!r.ok) return httpFailure(r, t0);
  return { ok: true, latencyMs: Date.now() - t0, modelTested: model };
}

async function probeGoogle(
  baseUrl: string,
  apiKey: string,
  model: string,
  t0: number,
): Promise<ConnectionTestResult> {
  const r = await fetch(
    `${stripTrailing(baseUrl)}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: 16 },
      }),
    },
  );
  if (!r.ok) return httpFailure(r, t0);
  return { ok: true, latencyMs: Date.now() - t0, modelTested: model };
}

async function httpFailure(r: Response, t0: number): Promise<ConnectionTestResult> {
  return {
    ok: false,
    errorMessage: `${r.status} ${(await r.text()).slice(0, 200)}`,
    latencyMs: Date.now() - t0,
  };
}

function stripTrailing(u: string): string {
  return u.replace(/\/+$/, '');
}
