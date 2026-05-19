# Runtime Integration Guide

`@maka/runtime` exposes `SessionManager`, `BackendRegistry`,
`PermissionEngine`, `AiSdkBackend`, `FakeBackend`, builtin tools, and provider
helpers.

Desktop wiring lives in `apps/desktop/src/main/main.ts`:

1. Create storage with `createSessionStore()` and `createConnectionStore()`.
2. Create one process-wide `PermissionEngine`.
3. Register `ai-sdk` and `fake` backends.
4. Use `AiSdkBackend` with `getAIModel`, `buildBuiltinTools()`, and the
   encrypted desktop credential store.
5. Forward `SessionEvent` values over `sessions:event:<sessionId>`.

Provider connection CRUD and probes are exposed through `connections:*` IPC
handlers. The runtime package provides:

- `getAIModel()` for provider/model construction
- `testConnection()` for small REST probes
- `fetchProviderModels()` for model discovery
- `buildBuiltinTools()` for Read, Write, Bash, Grep, Glob, and the currently
  unregistered Edit implementation
