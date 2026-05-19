import type { StoredMessage, ToolResultContent } from '@maka/core';

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface ToolActivityItem {
  toolUseId: string;
  toolName: string;
  displayName?: string;
  intent?: string;
  status: 'pending' | 'waiting_permission' | 'running' | 'completed' | 'errored' | 'interrupted';
  args: unknown;
  result?: ToolResultContent;
  durationMs?: number;
}

export function materializeChat(messages: StoredMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const message of messages) {
    if (message.type === 'user') items.push({ id: message.id, role: 'user', text: message.text });
    if (message.type === 'assistant') items.push({ id: message.id, role: 'assistant', text: message.text });
    if (message.type === 'system_note') items.push({ id: message.id, role: 'system', text: `${message.kind}` });
  }
  return items;
}

export function materializeTools(messages: StoredMessage[]): ToolActivityItem[] {
  const results = new Map(messages.filter((message) => message.type === 'tool_result').map((message) => [message.toolUseId, message]));
  return messages
    .filter((message) => message.type === 'tool_call')
    .map((call) => {
      const result = results.get(call.id);
      return {
        toolUseId: call.id,
        toolName: call.toolName,
        displayName: call.displayName,
        intent: call.intent,
        status: result ? (result.isError ? 'errored' : 'completed') : 'interrupted',
        args: call.args,
        result: result?.content,
        durationMs: result?.durationMs,
      };
    });
}
