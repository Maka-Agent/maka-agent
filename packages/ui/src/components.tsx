import { useState, type FormEvent } from 'react';
import {
  Archive,
  Flag,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquarePen,
} from 'lucide-react';
import type {
  PermissionRequestEvent,
  PermissionResponse,
  SessionSummary,
  StoredMessage,
  ToolResultContent,
} from '@maka/core';
import { materializeChat, materializeTools, type ToolActivityItem } from './materialize.js';

export type NavSelection =
  | { section: 'sessions'; filter: SessionFilter }
  | { section: 'skills' };

export type SessionFilter = 'chats' | 'flagged' | 'archived';

const FILTER_LABEL: Record<SessionFilter, string> = {
  chats: 'Chats',
  flagged: 'Flagged',
  archived: 'Archived',
};

function Count(props: { value: number }) {
  if (props.value <= 0) return null;
  return <small>{props.value}</small>;
}

export function SessionListPanel(props: {
  selection: NavSelection;
  sessionCounts: Record<SessionFilter, number>;
  sessions: SessionSummary[];
  activeId?: string;
  onSelectSession(sessionId: string): void;
  onSelect(selection: NavSelection): void;
  onOpenSettings(): void;
  onNew(): void;
}) {
  const isSessionFilter = (filter: SessionFilter) => props.selection.section === 'sessions' && props.selection.filter === filter;
  const title = props.selection.section === 'sessions' ? FILTER_LABEL[props.selection.filter] : 'Skills';

  return (
    <aside className="maka-session-panel" aria-label="Chats">
      <header className="maka-session-panel-header">
        <div className="maka-window-drag-strip" aria-hidden="true" />
        <button className="maka-nav-primary" type="button" onClick={props.onNew}>
          <SquarePen className="maka-nav-primary-icon" strokeWidth={1.5} />
          <span>New Chat</span>
        </button>
      </header>

      <div className="maka-session-filter">
        <button
          className="maka-nav-row"
          data-active={isSessionFilter('chats')}
          type="button"
          onClick={() => props.onSelect({ section: 'sessions', filter: 'chats' })}
        >
          <MessageSquare className="maka-nav-icon" strokeWidth={1.5} />
          <span>Chats</span>
          <Count value={props.sessionCounts.chats} />
        </button>
        <button
          className="maka-nav-row"
          data-active={isSessionFilter('flagged')}
          type="button"
          onClick={() => props.onSelect({ section: 'sessions', filter: 'flagged' })}
        >
          <Flag className="maka-nav-icon" strokeWidth={1.5} />
          <span>Pinned</span>
          <Count value={props.sessionCounts.flagged} />
        </button>
        <button
          className="maka-nav-row"
          data-active={isSessionFilter('archived')}
          type="button"
          onClick={() => props.onSelect({ section: 'sessions', filter: 'archived' })}
        >
          <Archive className="maka-nav-icon" strokeWidth={1.5} />
          <span>Archived</span>
          <Count value={props.sessionCounts.archived} />
        </button>
      </div>

      <div className="maka-session-search" aria-hidden="true">
        <Search strokeWidth={1.5} />
        <span>Search chats</span>
      </div>

      <section className="maka-session-list" aria-label={title}>
        <div className="maka-session-list-title">{title}</div>
        {props.selection.section === 'skills' ? (
          <div className="maka-empty-state">
            <Sparkles className="maka-empty-state-icon" strokeWidth={1.5} />
            <div className="maka-empty-state-title">No skills yet</div>
            <div className="maka-empty-state-body">Custom skills will appear here.</div>
          </div>
        ) : props.sessions.length === 0 ? (
          <div className="maka-empty-state">
            <MessageSquare className="maka-empty-state-icon" strokeWidth={1.5} />
            <div className="maka-empty-state-title">No chats yet</div>
            <div className="maka-empty-state-body">Chats with Maka appear here. Start one to get going.</div>
            <button className="maka-button maka-empty-state-cta" type="button" onClick={props.onNew}>
              New Chat
            </button>
          </div>
        ) : (
          <div className="maka-list-stack">
            {props.sessions.map((session) => (
              <button
                key={session.id}
                className="maka-list-row"
                data-active={session.id === props.activeId}
                type="button"
                onClick={() => props.onSelectSession(session.id)}
              >
                <div>
                  <div className="maka-list-row-name">{session.name}</div>
                  <div className="maka-list-row-meta">{formatSessionMeta(session)}</div>
                </div>
                {session.hasUnread && <span className="maka-list-row-unread" />}
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="maka-session-panel-footer">
        <button
          className="maka-nav-row"
          data-active={props.selection.section === 'skills'}
          type="button"
          onClick={() => props.onSelect({ section: 'skills' })}
        >
          <Sparkles className="maka-nav-icon" strokeWidth={1.5} />
          <span>Skills</span>
        </button>
        <button
          className="maka-nav-row"
          type="button"
          onClick={props.onOpenSettings}
        >
          <Settings className="maka-nav-icon" strokeWidth={1.5} />
          <span>Settings</span>
        </button>
      </footer>
    </aside>
  );
}

export function ChatView(props: {
  messages: StoredMessage[];
  streamingText: string;
  tools: ToolActivityItem[];
  activeSession?: SessionSummary;
  mode: NavSelection['section'];
  onNew(): void;
}) {
  const chat = materializeChat(props.messages);
  const storedTools = materializeTools(props.messages);
  const tools = mergeTools(storedTools, props.tools);

  if (props.mode === 'skills') {
    return (
      <main className="maka-main detailPane">
        <div className="maka-center-state">No skill selected</div>
      </main>
    );
  }

  if (!props.activeSession) {
    return (
      <main className="maka-main detailPane">
        <header className="maka-chat-header">
          <ChatTab title="New Chat" backend="fake" />
          <button className="maka-chat-tab-plus" type="button" aria-label="New chat" onClick={props.onNew}>
            <Plus strokeWidth={1.5} />
          </button>
          <span className="maka-chat-header-spacer" />
          <span className="modePill">Ask mode</span>
        </header>
        <div className="maka-chat messages">
          <div className="emptyChat compact">
            <span className="eyebrow">Maka</span>
            <h1>What should we work on?</h1>
            <p>Describe the change, question, or investigation.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="maka-main detailPane">
      <header className="maka-chat-header">
        <ChatTab title={props.activeSession.name} backend={props.activeSession.backend} />
        <button className="maka-chat-tab-plus" type="button" aria-label="New chat" onClick={props.onNew}>
          <Plus strokeWidth={1.5} />
        </button>
        <span className="maka-chat-header-spacer" />
        <span className="modePill">Ask mode</span>
      </header>
      <div className="maka-chat messages">
        {chat.length === 0 && !props.streamingText && (
          <div className="emptyChat compact">
            <span className="eyebrow">Maka</span>
            <h1>What should we work on?</h1>
            <p>Describe the change, question, or investigation.</p>
          </div>
        )}
        {chat.map((item) => (
          <article key={item.id} className={`maka-message-row message ${item.role}`}>
            <span>{item.role}</span>
            <pre className={item.role === 'user' ? 'maka-bubble-user' : 'maka-bubble-assistant'}>{item.text}</pre>
          </article>
        ))}
        {props.streamingText && (
          <article className="maka-message-row message assistant streaming">
            <span>assistant</span>
            <pre className="maka-bubble-assistant maka-bubble-streaming">{props.streamingText}</pre>
          </article>
        )}
        {tools.length > 0 && <ToolActivity items={tools} />}
      </div>
    </main>
  );
}

function ChatTab(props: { title: string; backend: string }) {
  return (
    <div className="maka-chat-tab" title={props.title}>
      <MessageSquare className="maka-chat-tab-icon" strokeWidth={1.5} />
      <span>{props.title}</span>
      <small>{props.backend}</small>
    </div>
  );
}

export function Composer(props: { disabled?: boolean; hidden?: boolean; onSend(text: string): void; onStop(): void }) {
  if (props.hidden) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = String(data.get('text') ?? '').trim();
    if (!text) return;
    props.onSend(text);
    form.reset();
  }

  return (
    <form className="maka-composer composer" onSubmit={submit}>
      <div className="maka-composer-inner composerInner">
        <textarea name="text" placeholder="Message Maka..." disabled={props.disabled} />
        <div className="maka-composer-toolbar composerActions">
          <span>{props.disabled ? 'Waiting for permission' : 'Enter to send'}</span>
          <div>
            <button className="maka-button" type="button" onClick={props.onStop}>Stop</button>
            <button className="maka-button" data-variant="primary" type="submit" disabled={props.disabled}>Send</button>
          </div>
        </div>
      </div>
    </form>
  );
}

export function ToolActivity(props: { items: ToolActivityItem[] }) {
  return (
    <section className="toolInline">
      <header>
        <strong>Activity</strong>
        <small>{props.items.length}</small>
      </header>
      {props.items.map((item) => (
        <div key={item.toolUseId} className="maka-tool toolItem" data-status={item.status}>
          <header className="maka-tool-header">
            <span className="maka-tool-name">
              {item.displayName ?? item.toolName}
            </span>
            <small>{item.status.replace('_', ' ')}</small>
          </header>
          {item.intent && <p>{item.intent}</p>}
          <pre className="maka-code toolArgs">{JSON.stringify(item.args, null, 2)}</pre>
          {item.result && <OverlayPreview content={item.result} />}
        </div>
      ))}
    </section>
  );
}

export function OverlayHost(props: { content?: ToolResultContent; onClose(): void }) {
  if (!props.content) return null;
  return (
    <div className="maka-modal-backdrop overlay">
      <button className="maka-button" onClick={props.onClose}>Close</button>
      <OverlayPreview content={props.content} />
    </div>
  );
}

export function PermissionDialog(props: {
  request: PermissionRequestEvent;
  onRespond(response: PermissionResponse): void;
}) {
  const [rememberForTurn, setRememberForTurn] = useState(false);

  function submit(decision: PermissionResponse['decision']) {
    props.onRespond({
      requestId: props.request.requestId,
      decision,
      rememberForTurn: decision === 'allow' ? rememberForTurn : false,
    });
  }

  return (
    <div className="maka-modal-backdrop permissionBackdrop">
      <section className="maka-modal permissionDialog" role="dialog" aria-modal="true" aria-labelledby="permissionTitle">
        <div className="maka-modal-header">
          <h2 className="maka-modal-title" id="permissionTitle">Permission required</h2>
          <p className="maka-modal-subtitle">
            {props.request.toolName} · <span className="maka-reason-text" data-reason={props.request.reason}>{props.request.reason}</span>
          </p>
        </div>
        <div className="maka-modal-body">
          <pre className="maka-code">{JSON.stringify(props.request.args, null, 2)}</pre>
          <label className="permissionRemember">
            <input
              type="checkbox"
              checked={rememberForTurn}
              onChange={(event) => setRememberForTurn(event.currentTarget.checked)}
            />
            Remember for this turn
          </label>
        </div>
        <div className="maka-modal-footer permissionActions">
          <button className="maka-button" data-variant="ghost" type="button" onClick={() => submit('deny')}>Deny</button>
          <button className="maka-button" data-variant="primary" type="button" onClick={() => submit('allow')}>Allow</button>
        </div>
      </section>
    </div>
  );
}

function OverlayPreview(props: { content: ToolResultContent }) {
  if (props.content.kind === 'text') return <pre>{props.content.text}</pre>;
  if (props.content.kind === 'json') return <pre>{JSON.stringify(props.content.value, null, 2)}</pre>;
  if (props.content.kind === 'terminal') return <pre>{props.content.stdout || props.content.stderr}</pre>;
  if (props.content.kind === 'file_diff') return <pre>{props.content.diff}</pre>;
  return <pre>{props.content.kind}</pre>;
}

function mergeTools(stored: ToolActivityItem[], live: ToolActivityItem[]): ToolActivityItem[] {
  const byId = new Map(stored.map((item) => [item.toolUseId, item]));
  for (const item of live) byId.set(item.toolUseId, { ...byId.get(item.toolUseId), ...item });
  return [...byId.values()];
}

function formatSessionMeta(session: SessionSummary): string {
  if (!session.lastMessageAt) return 'No messages yet';
  const diffMs = Date.now() - session.lastMessageAt;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60_000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}
