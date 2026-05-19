import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ConnectionEvent,
  LlmConnection,
  PermissionRequestEvent,
  PermissionResponse,
  SessionEvent,
  SessionSummary,
  StoredMessage,
} from '@maka/core';
import {
  ChatView,
  Composer,
  type NavSelection,
  PermissionDialog,
  SessionListPanel,
  type ToolActivityItem,
} from '@maka/ui';
import { ProvidersPanel } from './settings/ProvidersPanel';
import './styles.css';

function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [navSelection, setNavSelection] = useState<NavSelection>({ section: 'sessions', filter: 'chats' });
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [streamingBySession, setStreamingBySession] = useState<Record<string, string>>({});
  const [liveToolsBySession, setLiveToolsBySession] = useState<Record<string, ToolActivityItem[]>>({});
  const [permissionBySession, setPermissionBySession] = useState<Record<string, PermissionRequestEvent | undefined>>({});
  const [connections, setConnections] = useState<LlmConnection[]>([]);
  const [defaultConnection, setDefaultConnection] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activeStreaming = activeId ? streamingBySession[activeId] ?? '' : '';
  const liveTools = useMemo(() => (activeId ? liveToolsBySession[activeId] ?? [] : []), [activeId, liveToolsBySession]);
  const activePermission = activeId ? permissionBySession[activeId] : undefined;
  const activeSession = sessions.find((session) => session.id === activeId);
  const activeSessionForView: SessionSummary | undefined = activeSession ?? (activeId ? {
    id: activeId,
    name: 'New Chat',
    isFlagged: false,
    isArchived: false,
    labels: [],
    hasUnread: false,
    backend: 'fake',
    llmConnectionSlug: 'default',
  } : undefined);
  const visibleSessions = useMemo(() => filterSessions(sessions, navSelection), [sessions, navSelection]);
  const sessionCounts = useMemo(() => countSessions(sessions), [sessions]);
  const [sessionListWidth, setSessionListWidth] = useState(() => readSessionListWidth());

  useEffect(() => {
    void refreshSessions();
    void refreshConnections();
    const unsubscribeConnections = window.maka.connections.subscribeEvents(handleConnectionEvent);
    const unsubscribeOpenSettings = window.maka.appWindow.subscribeOpenSettings(openSettings);
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        openSettings();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsubscribeConnections();
      unsubscribeOpenSettings();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let disposed = false;
    void window.maka.sessions.readMessages(activeId).then((next) => {
      if (!disposed) setMessages(next);
    });
    const unsubscribe = window.maka.sessions.subscribeEvents(activeId, (event) => {
      handleEvent(activeId, event);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [activeId]);

  useEffect(() => {
    localStorage.setItem('maka-chat-list-width-v1', String(sessionListWidth));
  }, [sessionListWidth]);

  async function refreshSessions() {
    const next = await window.maka.sessions.list();
    setSessions(next);
    if (!activeId && next[0] && next[0].lastMessageAt) setActiveId(next[0].id);
  }

  async function refreshConnections() {
    const [next, nextDefault] = await Promise.all([
      window.maka.connections.list(),
      window.maka.connections.getDefault(),
    ]);
    setConnections(next);
    setDefaultConnection(nextDefault);
  }

  async function createSession() {
    setActiveId(undefined);
    setNavSelection({ section: 'sessions', filter: 'chats' });
    setMessages([]);
    setStreamingBySession({});
    setLiveToolsBySession({});
    setPermissionBySession({});
  }

  async function send(text: string) {
    if (!activeId) {
      const session = await window.maka.sessions.create({
        permissionMode: 'ask',
        name: text.slice(0, 42) || 'New Chat',
      });
      setActiveId(session.id);
      await refreshSessions();
      await window.maka.sessions.send(session.id, { type: 'send', turnId: crypto.randomUUID(), text });
      return;
    }
    await window.maka.sessions.send(activeId, { type: 'send', turnId: crypto.randomUUID(), text });
    await refreshMessages(activeId);
  }

  async function stop() {
    if (activeId) await window.maka.sessions.stop(activeId);
  }

  async function respondToPermission(response: PermissionResponse) {
    if (!activeId) return;
    await window.maka.sessions.respondToPermission(activeId, response);
  }

  async function refreshMessages(sessionId: string) {
    setMessages(await window.maka.sessions.readMessages(sessionId));
  }

  function handleEvent(sessionId: string, event: SessionEvent) {
    switch (event.type) {
      case 'text_delta':
        setStreamingBySession((current) => ({
          ...current,
          [sessionId]: (current[sessionId] ?? '') + event.text,
        }));
        break;
      case 'text_complete':
        setStreamingBySession((current) => ({ ...current, [sessionId]: '' }));
        void refreshMessages(sessionId);
        break;
      case 'tool_start':
        upsertTool(sessionId, event.toolUseId, {
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          displayName: event.displayName,
          intent: event.intent,
          status: 'pending',
          args: event.args,
        });
        break;
      case 'permission_request':
        setPermissionBySession((current) => ({ ...current, [sessionId]: event }));
        upsertTool(sessionId, event.toolUseId, {
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          status: 'waiting_permission',
          args: event.args,
        });
        break;
      case 'permission_decision_ack':
        setPermissionBySession((current) => {
          const active = current[sessionId];
          if (!active || active.requestId !== event.requestId) return current;
          return { ...current, [sessionId]: undefined };
        });
        upsertTool(sessionId, event.toolUseId, {
          toolUseId: event.toolUseId,
          status: event.decision === 'allow' ? 'running' : 'errored',
        });
        break;
      case 'tool_result':
        upsertTool(sessionId, event.toolUseId, {
          toolUseId: event.toolUseId,
          status: event.isError ? 'errored' : 'completed',
          result: event.content,
          durationMs: event.durationMs,
        });
        void refreshMessages(sessionId);
        break;
      case 'error':
      case 'abort':
      case 'complete':
        void refreshSessions();
        void refreshMessages(sessionId);
        break;
      default:
        break;
    }
  }

  function handleConnectionEvent(event: ConnectionEvent) {
    switch (event.type) {
      case 'connection_list_changed':
        void refreshConnections();
        break;
    }
  }

  function openSettings() {
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  function upsertTool(sessionId: string, toolUseId: string, patch: Partial<ToolActivityItem> & { toolUseId: string }) {
    setLiveToolsBySession((current) => {
      const list = current[sessionId] ?? [];
      const index = list.findIndex((item) => item.toolUseId === toolUseId);
      const base: ToolActivityItem =
        index >= 0
          ? list[index]!
          : {
              toolUseId,
              toolName: patch.toolName ?? 'Tool',
              status: 'pending',
              args: patch.args,
            };
      const nextItem = { ...base, ...patch };
      const nextList = index >= 0 ? list.map((item, itemIndex) => (itemIndex === index ? nextItem : item)) : [...list, nextItem];
      return { ...current, [sessionId]: nextList };
    });
  }

  function startColumnResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const start = sessionListWidth;
    document.body.classList.add('isResizingColumns');

    function onMove(moveEvent: globalThis.PointerEvent) {
      const delta = moveEvent.clientX - startX;
      setSessionListWidth(clamp(start + delta, 240, 420));
    }

    function onUp() {
      document.body.classList.remove('isResizingColumns');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  return (
    <div className="appFrame">
      <div
        className="app maka-shell-2col"
        style={{
          '--maka-session-list-width': `${sessionListWidth}px`,
        } as CSSProperties}
      >
        <div className="maka-panel maka-panel-list maka-floating-panel">
          <SessionListPanel
            selection={navSelection}
            sessionCounts={sessionCounts}
            sessions={visibleSessions}
            activeId={activeId}
            onSelect={setNavSelection}
            onSelectSession={setActiveId}
            onOpenSettings={openSettings}
            onNew={createSession}
          />
        </div>
        <div
          className="maka-resize-handle"
          role="separator"
          aria-label="Resize chat list"
          onPointerDown={startColumnResize}
        />
        <div className="maka-panel maka-panel-detail maka-floating-panel">
          <div className="mainColumn">
            <ChatView
              messages={messages}
              streamingText={activeStreaming}
              tools={liveTools}
              activeSession={activeSessionForView}
              mode={navSelection.section}
              onNew={createSession}
            />
            <Composer
              hidden={navSelection.section !== 'sessions'}
              disabled={Boolean(activePermission)}
              onSend={send}
              onStop={stop}
            />
          </div>
        </div>
      </div>
      {activePermission && (
        <PermissionDialog
          request={activePermission}
          onRespond={respondToPermission}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          connections={connections}
          defaultSlug={defaultConnection}
          onRefresh={refreshConnections}
          onClose={closeSettings}
        />
      )}
    </div>
  );
}

function readSessionListWidth(): number {
  const stored = Number(localStorage.getItem('maka-chat-list-width-v1'));
  if (Number.isFinite(stored) && stored > 0) return clamp(stored, 240, 420);
  return 320;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function filterSessions(sessions: SessionSummary[], selection: NavSelection): SessionSummary[] {
  if (selection.section !== 'sessions') return [];
  switch (selection.filter) {
    case 'flagged':
      return sessions.filter((session) => session.isFlagged && !session.isArchived && session.lastMessageAt);
    case 'archived':
      return sessions.filter((session) => session.isArchived);
    case 'chats':
      return sessions.filter((session) => !session.isArchived && session.lastMessageAt);
  }
}

function countSessions(sessions: SessionSummary[]) {
  return {
    chats: sessions.filter((session) => !session.isArchived && session.lastMessageAt).length,
    flagged: sessions.filter((session) => session.isFlagged && !session.isArchived && session.lastMessageAt).length,
    archived: sessions.filter((session) => session.isArchived).length,
  };
}

type SettingsTab = 'general' | 'providers' | 'permissions' | 'appearance' | 'about';

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; detail: string }> = [
  { id: 'general', label: 'General', detail: 'Startup and chat defaults' },
  { id: 'providers', label: 'Providers', detail: 'Models, keys, and endpoints' },
  { id: 'permissions', label: 'Permissions', detail: 'Tool approval behavior' },
  { id: 'appearance', label: 'Appearance', detail: 'Theme and density' },
  { id: 'about', label: 'About', detail: 'Version and diagnostics' },
];

function SettingsModal(props: {
  connections: LlmConnection[];
  defaultSlug: string | null;
  onRefresh(): Promise<void>;
  onClose(): void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onClose]);

  return (
    <div className="settingsModalBackdrop" role="presentation" onMouseDown={props.onClose}>
      <div className="settingsModal" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(event) => event.stopPropagation()}>
        <SettingsSurface
          connections={props.connections}
          defaultSlug={props.defaultSlug}
          onRefresh={props.onRefresh}
          onClose={props.onClose}
          modal
        />
      </div>
    </div>
  );
}

function SettingsSurface(props: {
  connections: LlmConnection[];
  defaultSlug: string | null;
  onRefresh(): Promise<void>;
  onClose?: () => void;
  modal?: boolean;
}) {
  const [tab, setTab] = useState<SettingsTab>('providers');

  return (
    <main className="settingsSurface" data-modal={props.modal ? 'true' : undefined}>
      <header className="settingsHeader">
        <div>
          <span>Settings ⌘,</span>
          <h1>Preferences</h1>
        </div>
        {props.onClose ? (
          <button className="settingsCloseButton" type="button" aria-label="Close settings" onClick={props.onClose}>×</button>
        ) : (
          <button className="maka-button" type="button" onClick={props.onRefresh}>Refresh</button>
        )}
      </header>

      <div className="settingsBody">
        <nav className="settingsTabs" aria-label="Settings sections">
          {SETTINGS_TABS.map((item) => (
            <button
              key={item.id}
              className="settingsTab"
              data-active={tab === item.id}
              type="button"
              onClick={() => setTab(item.id)}
            >
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
        </nav>

        <div className="settingsContent">
          {tab === 'providers' && (
            <section className="settingsCard settingsCardProviders">
              <div className="settingsCardHeader">
                <div>
                  <h2>Providers</h2>
                  <p>Configure model providers and their credentials.</p>
                </div>
                {props.connections.length > 0 && <span className="settingsBadge">{props.connections.length} saved</span>}
              </div>
              <ProvidersPanel bridge={window.maka.connections} />
            </section>
          )}

          {tab === 'general' && (
            <section className="settingsCard">
              <h2>General</h2>
              <div className="settingsRows">
                <SettingRow title="Startup" detail="Open to the most recent chat when available." value="Enabled" />
                <SettingRow title="New chat mode" detail="New conversations start in Ask mode." value="Ask" />
                <SettingRow title="Default provider" detail="Used for new chats unless a chat is locked to another provider." value={props.defaultSlug ?? 'Not set'} />
              </div>
            </section>
          )}

          {tab === 'permissions' && (
            <section className="settingsCard">
              <h2>Permissions</h2>
              <div className="settingsRows">
                <SettingRow title="Default policy" detail="Ask before tools perform sensitive actions." value="Ask" />
                <SettingRow title="Shell commands" detail="Destructive filesystem commands require approval." value="Protected" />
                <SettingRow title="Provider credentials" detail="API keys are encrypted locally with the system credential store." value="Enabled" />
              </div>
            </section>
          )}

          {tab === 'appearance' && (
            <section className="settingsCard">
              <h2>Appearance</h2>
              <div className="settingsRows">
                <SettingRow title="Theme" detail="Use the current light visual system." value="Light" />
                <SettingRow title="Panel style" detail="Floating panels with native macOS controls." value="Floating" />
                <SettingRow title="Density" detail="Compact desktop spacing." value="Compact" />
              </div>
            </section>
          )}

          {tab === 'about' && (
            <section className="settingsCard">
              <h2>About Maka</h2>
              <div className="settingsRows">
                <SettingRow title="Version" detail="Local development build." value="0.1.0" />
                <SettingRow title="Runtime" detail="Electron desktop with React renderer." value="Electron 39" />
                <SettingRow title="Storage" detail="JSONL sessions and encrypted provider credentials." value="Local" />
              </div>
            </section>
          )}
        </div>
      </div>
      {props.onClose && (
        <button className="settingsDoneButton" type="button" onClick={props.onClose}>Done</button>
      )}
    </main>
  );
}

function SettingRow(props: { title: string; detail: string; value: string }) {
  return (
    <div className="settingsRow">
      <div>
        <strong>{props.title}</strong>
        <small>{props.detail}</small>
      </div>
      <span>{props.value}</span>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
