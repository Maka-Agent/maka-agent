# Maka

Local desktop assistant agent for Maka.

## Current Shape

- Core schemas for sessions, events, permissions, and provider connections
- JSONL session storage plus file-backed provider connection storage
- Electron desktop shell with React renderer
- Unified provider runtime through Vercel AI SDK
- Fake backend fallback when no provider or API key is configured
- Permission engine and local builtin tools for Read, Write, Bash, Grep, and Glob
- Settings Providers panel for API keys, model discovery, testing, and defaults

## Development

Use npm for local validation:

```sh
npm install
npm run build
npm run typecheck
npm run dev
```

`npm run dev` requires Electron's platform binary. If install was run with
`ELECTRON_SKIP_BINARY_DOWNLOAD=1`, run `node node_modules/electron/install.js`
once before launching.

## Providers

Sessions use backend kind `ai-sdk` for real model providers and `fake` as the
local fallback. Provider metadata is stored in the local Maka data directory as
`llm-connections.json`; credentials are encrypted with Electron `safeStorage`
and stored as `credentials.json`.

The app bootstraps a default provider from `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY` when no saved providers exist. Additional providers can be
created in Settings -> Providers.

## Smoke Test

```sh
node --input-type=module <<'EOF'
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSessionStore } from './packages/storage/dist/index.js';
import { BackendRegistry, FakeBackend, SessionManager } from './packages/runtime/dist/index.js';

const root = await mkdtemp(join(tmpdir(), 'maka-smoke-'));
const store = createSessionStore(root);
const backends = new BackendRegistry();
backends.register('fake', (ctx) => new FakeBackend({ sessionId: ctx.sessionId, header: ctx.header, store: ctx.store }));
const runtime = new SessionManager({ store, backends, newId: randomUUID, now: Date.now });
const session = await runtime.createSession({ cwd: root, backend: 'fake', llmConnectionSlug: 'fake', model: 'fake', permissionMode: 'ask', name: 'Smoke' });
for await (const event of runtime.sendMessage(session.id, { turnId: 'turn-smoke', text: 'hello' })) {
  console.log(event.type, event.turnId);
}
console.log((await runtime.getMessages(session.id)).map((m) => m.type));
EOF
```
