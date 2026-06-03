export const CODEX_SUBSCRIPTION_USER_AGENT = 'codex-cli/0.0.0 (external, cli)';

export function codexSubscriptionHeaders(accessToken: string): Record<string, string> {
  const accountId = extractCodexAccountId(accessToken);
  return {
    ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
    'User-Agent': CODEX_SUBSCRIPTION_USER_AGENT,
  };
}

export function extractCodexAccountId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;
  const auth = payload['https://api.openai.com/auth'];
  if (auth && typeof auth === 'object') {
    const value = (auth as Record<string, unknown>).chatgpt_account_id;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const sub = payload.sub;
  return typeof sub === 'string' && sub.trim() ? sub.trim() : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const json = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
