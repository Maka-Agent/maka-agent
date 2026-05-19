import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ConnectionEvent,
  CreateConnectionInput,
  CreateSessionInput,
  SessionCommand,
  SessionEvent,
  SessionListFilter,
  UpdateConnectionInput,
} from '@maka/core';
import {
  AiSdkBackend,
  BackendRegistry,
  FakeBackend,
  PermissionEngine,
  SessionManager,
  buildBuiltinTools,
  fetchProviderModels,
  getAIModel,
  testConnection,
} from '@maka/runtime';
import { PROVIDER_DEFAULTS } from '@maka/core/llm-connections';
import { createConnectionStore, createSessionStore } from '@maka/storage';
import { createSafeStorageCredentialStore } from './credential-store.js';

const workspaceRoot = join(app.getPath('userData'), 'workspaces', 'default');
const store = createSessionStore(workspaceRoot);
const connectionStore = createConnectionStore(workspaceRoot);
const credentialStore = createSafeStorageCredentialStore(workspaceRoot);
const backends = new BackendRegistry();
const permissionEngine = new PermissionEngine({ newId: randomUUID, now: Date.now });
const builtinTools = buildBuiltinTools().filter((tool) => tool.name !== 'Edit');

app.setName('Maka');

backends.register('ai-sdk', async (ctx) => {
  const connection = await connectionStore.get(ctx.header.llmConnectionSlug);
  if (!connection?.enabled) {
    return new FakeBackend({ sessionId: ctx.sessionId, header: ctx.header, store: ctx.store });
  }

  const apiKey = await credentialStore.getSecret(connection.slug, 'api_key');
  if (PROVIDER_DEFAULTS[connection.providerType].authKind !== 'none' && !apiKey) {
    return new FakeBackend({ sessionId: ctx.sessionId, header: ctx.header, store: ctx.store });
  }

  return new AiSdkBackend({
    sessionId: ctx.sessionId,
    header: ctx.header,
    appendMessage: (message) => ctx.store.appendMessage(ctx.sessionId, message),
    connection,
    apiKey: apiKey ?? '',
    modelId: ctx.header.model || connection.defaultModel,
    permissionEngine,
    modelFactory: getAIModel,
    tools: builtinTools,
    newId: randomUUID,
    now: Date.now,
  });
});

backends.register('fake', (ctx) =>
  new FakeBackend({ sessionId: ctx.sessionId, header: ctx.header, store: ctx.store }),
);

const runtime = new SessionManager({
  store,
  backends,
  newId: randomUUID,
  now: Date.now,
});

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });
  installApplicationMenu();
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    title: 'Maka',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 24, y: 24 },
    backgroundColor: '#f3f3f5',
    webPreferences: {
      preload: join(import.meta.dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(import.meta.dirname, '..', 'renderer', 'index.html'));
  }
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Maka',
        submenu: [
          { role: 'about', label: 'About Maka' },
          {
            label: 'Preferences...',
            accelerator: 'CommandOrControl+,',
            click: () => mainWindow?.webContents.send('window:openSettings'),
          },
          { type: 'separator' },
          { role: 'hide', label: 'Hide Maka' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: 'Quit Maka' },
        ],
      },
      { label: 'File', submenu: [{ role: 'close' }] },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
    ]),
  );
}

function registerIpc(): void {
  ipcMain.handle('sessions:list', (_event, filter?: SessionListFilter) => runtime.listSessions(filter));
  ipcMain.handle('sessions:create', async (_event, input?: Partial<CreateSessionInput>) => {
    const cwd = input?.cwd ?? process.cwd();
    const requestedSlug = input?.llmConnectionSlug ?? (await connectionStore.getDefault());
    const connection = requestedSlug ? await connectionStore.get(requestedSlug) : null;
    const backend = input?.backend === 'fake' || !connection ? 'fake' : 'ai-sdk';

    return runtime.createSession({
      cwd,
      backend,
      llmConnectionSlug: connection?.slug ?? requestedSlug ?? 'fake',
      model: input?.model ?? connection?.defaultModel ?? 'fake-model',
      permissionMode: input?.permissionMode ?? 'ask',
      name: input?.name ?? 'New Chat',
      labels: input?.labels,
    });
  });
  ipcMain.handle('sessions:readMessages', (_event, sessionId: string) => runtime.getMessages(sessionId));
  ipcMain.handle('sessions:stop', (_event, sessionId: string) => runtime.stopSession(sessionId));
  ipcMain.handle('sessions:respondToPermission', (_event, sessionId: string, response) =>
    runtime.respondToPermission(sessionId, response),
  );
  ipcMain.handle('sessions:send', async (_event, sessionId: string, command: SessionCommand) => {
    if (command.type !== 'send') return;
    const iterator = runtime.sendMessage(sessionId, {
      turnId: command.turnId || randomUUID(),
      text: command.text,
      attachments: command.attachments,
    });
    void streamEvents(sessionId, iterator);
  });

  ipcMain.handle('connections:list', () => connectionStore.list());
  ipcMain.handle('connections:getDefault', () => connectionStore.getDefault());
  ipcMain.handle('connections:setDefault', async (_event, slug: string | null) => {
    if (slug && !(await connectionStore.get(slug))) {
      throw new Error(`No such connection: ${slug}`);
    }
    await connectionStore.setDefault(slug);
    emitConnectionListChanged();
  });
  ipcMain.handle('connections:create', async (_event, input: CreateConnectionInput) => {
    const connection = await connectionStore.create(input);
    if (input.apiKey) {
      await credentialStore.setSecret(connection.slug, 'api_key', input.apiKey);
    }
    emitConnectionListChanged();
    return connection;
  });
  ipcMain.handle('connections:update', async (_event, slug: string, patch: UpdateConnectionInput) => {
    const connection = await connectionStore.update(slug, patch);
    if (patch.apiKey !== undefined) {
      if (patch.apiKey) await credentialStore.setSecret(slug, 'api_key', patch.apiKey);
      else await credentialStore.deleteSecret(slug, 'api_key');
    }
    emitConnectionListChanged();
    return connection;
  });
  ipcMain.handle('connections:delete', async (_event, slug: string) => {
    await connectionStore.delete(slug);
    await credentialStore.deleteSecret(slug);
    emitConnectionListChanged();
  });
  ipcMain.handle('connections:test', async (_event, slug: string, opts?: { model?: string }) => {
    const connection = await connectionStore.get(slug);
    if (!connection) return { ok: false, errorMessage: `No such connection: ${slug}` };
    const apiKey = await credentialStore.getSecret(slug, 'api_key');
    if (PROVIDER_DEFAULTS[connection.providerType].authKind !== 'none' && !apiKey) {
      return { ok: false, errorMessage: 'No API key set for this connection' };
    }
    return testConnection(connection, apiKey ?? '', opts?.model);
  });
  ipcMain.handle('connections:fetchModels', async (_event, slug: string) => {
    const connection = await connectionStore.get(slug);
    if (!connection) throw new Error(`No such connection: ${slug}`);
    const apiKey = await credentialStore.getSecret(slug, 'api_key');
    if (PROVIDER_DEFAULTS[connection.providerType].authKind !== 'none' && !apiKey) {
      throw new Error('No API key set for this connection');
    }
    return fetchProviderModels(connection, apiKey ?? '');
  });
  ipcMain.handle('connections:hasSecret', async (_event, slug: string) =>
    Boolean(await credentialStore.getSecret(slug, 'api_key')),
  );
}

async function streamEvents(sessionId: string, iterator: AsyncIterable<SessionEvent>): Promise<void> {
  for await (const event of iterator) {
    mainWindow?.webContents.send(`sessions:event:${sessionId}`, event);
  }
}

function emitConnectionListChanged(): void {
  const event: ConnectionEvent = {
    type: 'connection_list_changed',
    id: randomUUID(),
    ts: Date.now(),
  };
  mainWindow?.webContents.send('connections:event', event);
}

async function ensureBootstrapConnection(): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });
  if ((await connectionStore.list()).length > 0) return;

  if (process.env.ANTHROPIC_API_KEY) {
    const slug = 'env-anthropic';
    await connectionStore.create({
      slug,
      name: 'Anthropic (env)',
      providerType: 'anthropic',
      defaultModel: 'claude-sonnet-4-5-20250929',
    });
    await credentialStore.setSecret(slug, 'api_key', process.env.ANTHROPIC_API_KEY);
    await connectionStore.setDefault(slug);
    return;
  }

  if (process.env.OPENAI_API_KEY) {
    const slug = 'env-openai';
    await connectionStore.create({
      slug,
      name: 'OpenAI (env)',
      providerType: 'openai',
      defaultModel: 'gpt-4o-mini',
    });
    await credentialStore.setSecret(slug, 'api_key', process.env.OPENAI_API_KEY);
    await connectionStore.setDefault(slug);
  }
}

registerIpc();

app.whenReady().then(async () => {
  await ensureBootstrapConnection();
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
