# Changelog

## Unreleased

### Runtime kernel extraction

This change set turns the runtime execution path from a large implicit
`SessionManager` / `AiSdkBackend` flow into an internal runtime-kernel shape.
It keeps the existing desktop, renderer, IPC, session JSONL, settings, bot, and
gateway surfaces stable while moving model, tool, trace, run-ledger, and
startup-recovery responsibilities behind explicit internal boundaries.

| Area | Summary |
| --- | --- |
| Tool runtime | Extracted an internal `ToolRuntime` around tool input validation, permission checks, watchdog pause/resume, abort propagation, telemetry, artifact recording, and failure classification. |
| Model adapter | Extracted a minimal `ModelAdapter` so provider stream/error/usage normalization no longer lives directly in the backend orchestration shell. |
| Runtime trace | Added best-effort `RunTrace` events for model, tool, permission, abort, and usage milestones without changing renderer-visible `SessionEvent` behavior. |
| AgentRun ledger | Added core `AgentRun` types and a file-backed `AgentRunStore` at `sessions/<sessionId>/runs/<runId>/run.json` plus `events.jsonl`. |
| AgentRun execution | Moved the heavy turn execution lifecycle from `SessionManager.sendMessage()` into internal `AgentRun.execute()`, including user-message append, backend stream drive, status projection, abort/failure handling, and durable trace writes. |
| Startup recovery | Made `recoverInterruptedSessions()` prefer the AgentRun ledger when available, repairing stale non-terminal runs and preserving the legacy message/turn-state fallback for older sessions. |

See `docs/runtime-kernel.md` for the design rationale, boundaries, and
verification details.

### Hardening phases 1-5

This change set collects the first five maintenance hardening phases from the
Rive deep-read follow-up work.

| Phase | Area | Summary |
| --- | --- | --- |
| 1 | Runtime permission and usage handling | Made stream watchdog pause/resume accounting robust for concurrent tool calls, added permission timeout handling, integrated Office document abort propagation, and fixed cache/reasoning token usage extraction. |
| 2 | Session JSONL recovery | Recovered sessions with corrupt JSONL rows by parsing message lines independently, surfacing landed corrupt rows as `system_note`, and dropping malformed truncated tail rows. |
| 3 | Bot and OpenGateway abuse controls | Added bot inbound rate and session-binding limits, bounded bot dedupe state, forced bot-bound sessions to `explore`, and capped OpenGateway SSE connections with idle cleanup. |
| 4 | Credential-store secret kind expansion | Extended encrypted credential-store support for bot tokens, bot app secrets, proxy passwords, gateway tokens, and Tavily API keys while preserving legacy API-key/OAuth-token key formats. |
| 5 | Connection credential IPC input hardening | Added shared main-process validation for renderer-controlled connection slugs and API keys before store, credential, or provider side effects. |

### Verification

- Runtime package typecheck/build and full runtime test suite.
- Desktop main build/typecheck.
- Storage package build and AgentRun store tests.
- Runtime package typecheck/build and focused runtime tests.
- Storage package build and focused session-store tests.
- Desktop main build/typecheck and focused bot/OpenGateway, credential-store,
  settings/web-search, connection IPC, OAuth, and model-provider regression
  suites.
- `git diff --check` before each pushed phase.
