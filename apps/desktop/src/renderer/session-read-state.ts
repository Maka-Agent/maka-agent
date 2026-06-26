import type { SessionSummary, StoredMessage } from '@maka/core';

export type SessionReadBoundaries = Record<string, number>;

export function rememberSessionReadBoundary(
  boundaries: SessionReadBoundaries,
  sessionId: string,
  messages: readonly StoredMessage[],
  fallbackLastMessageAt?: number,
): void {
  const boundary = latestMessageTs(messages) ?? fallbackLastMessageAt;
  if (boundary === undefined) return;
  boundaries[sessionId] = Math.max(boundaries[sessionId] ?? 0, boundary);
}

export function applySessionReadOverrides(
  sessions: readonly SessionSummary[],
  boundaries: Readonly<SessionReadBoundaries>,
): SessionSummary[] {
  let changed = false;
  const next = sessions.map((session) => {
    const boundary = boundaries[session.id];
    if (boundary === undefined || !session.hasUnread) return session;
    if ((session.lastMessageAt ?? 0) > boundary) return session;
    changed = true;
    return { ...session, hasUnread: false };
  });
  return changed ? next : [...sessions];
}

function latestMessageTs(messages: readonly StoredMessage[]): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    if (!Number.isFinite(message.ts)) continue;
    latest = latest === undefined ? message.ts : Math.max(latest, message.ts);
  }
  return latest;
}
