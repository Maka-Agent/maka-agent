import { createHash } from 'node:crypto';
import type { ArtifactStore } from '@maka/storage';
import type { ToolResultArchiveRecorderInput } from '@maka/runtime';

export async function persistArchivedToolResultToArtifacts(
  artifactStore: Pick<ArtifactStore, 'create' | 'get' | 'readText'>,
  event: ToolResultArchiveRecorderInput,
): Promise<{ artifactId: string }> {
  const id = stableToolResultArchiveArtifactId(event);
  const existing = await artifactStore.get(id);
  if (existing?.status === 'live') {
    if (existing.source !== 'tool_result_archive') throw new Error('tool result archive artifact id conflict: source mismatch');
    if (existing.sessionId !== event.sessionId) throw new Error('tool result archive artifact id conflict: session mismatch');
    if (existing.sizeBytes !== event.originalBytes) throw new Error('tool result archive artifact id conflict: size mismatch');
    const read = await artifactStore.readText(id, { maxBytes: event.originalBytes });
    if (!read.ok) throw new Error(`tool result archive artifact id conflict: ${read.reason}`);
    if (sha256(read.text) !== event.bodySha256) throw new Error('tool result archive artifact id conflict: hash mismatch');
    return { artifactId: id };
  }

  const artifact = await artifactStore.create({
    id,
    sessionId: event.sessionId,
    turnId: event.turnId,
    name: `tool-result-${event.runtimeEventId}.json`,
    kind: 'file',
    content: event.serializedResult,
    mimeType: 'application/json',
    source: 'tool_result_archive',
    summary: `Archived ${event.toolName} tool result for context budget replay`,
  });
  return { artifactId: artifact.id };
}

export function stableToolResultArchiveArtifactId(event: Pick<
  ToolResultArchiveRecorderInput,
  'sessionId' | 'runtimeEventId' | 'toolCallId' | 'toolName' | 'bodySha256' | 'rewriteVersion'
>): string {
  return `tool-result-archive-${sha256(JSON.stringify({
    sessionId: event.sessionId,
    runtimeEventId: event.runtimeEventId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    bodySha256: event.bodySha256,
    rewriteVersion: event.rewriteVersion,
  })).slice(0, 32)}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
