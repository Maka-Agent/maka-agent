# @maka/lab

A headless lab for measuring an agent configuration: run a **Config × Task**
grid in isolated sandboxes, capture each trajectory, score it with the
task's own test command, and compare. RFC: [#31](https://github.com/jackwener/maka-agent/issues/31).

```
Config × Task  →  throwaway workspace  →  headless agent run  →  trajectory
                                                                     ↓
                              ResultRecord (JSONL)  ←  verification command
```

## CLI

```sh
maka-lab run <spec.json> [--out <dir>]   # run the grid → results.jsonl + comparison.md
maka-lab compare <results.jsonl>         # print the comparison table
```

Try it with the bundled fake-backend demo (no API key needed):

```sh
maka-lab run examples/demo.spec.json --out /tmp/maka-lab-demo
```

## Spec

A spec is `connections × configs × tasks`. Task `workspaceDir` paths resolve
relative to the spec file, so a spec travels with its fixtures.

```jsonc
{
  // Only needed for real ('ai-sdk') runs. The API key is read from the
  // named env var — never written to the spec.
  "connections": [
    { "slug": "anthropic", "providerType": "anthropic",
      "defaultModel": "claude-sonnet-4-6", "apiKeyEnv": "ANTHROPIC_API_KEY" }
  ],
  "configs": [
    { "id": "sonnet", "backend": "ai-sdk", "llmConnectionSlug": "anthropic",
      "model": "claude-sonnet-4-6" }
  ],
  "tasks": [
    { "id": "fix-bug", "instruction": "Make the failing test pass.",
      "workspaceDir": "./fixtures/fix-bug",
      "verification": { "command": "npm test", "timeoutMs": 120000 } }
  ]
}
```

## Backends

- **`fake`** — deterministic stub (no model, no tools). For exercising the
  pipeline; it never edits files, so a task passes only if its fixture
  already satisfies the verification.
- **`ai-sdk`** — a real model. Reads the key from `apiKeyEnv`; the lab
  carries no secrets at rest.

  **No host isolation yet.** A real run executes the model's tool calls
  (shell, file writes) on your machine with your privileges — the same
  exposure as running Maka or any local agent directly. The throwaway
  workspace keeps a run from mutating the source fixture, but a tool can
  still read host files, your environment, or the network. Irreversible
  host-reaching categories (delete, destructive git, privileged, browser)
  are denied by default, which only narrows the blast radius. **Run only
  models and tasks you trust.** Per-run container isolation (mount the
  workspace only, env allowlist, network policy) is the planned hardening;
  `allowDangerousTools` is meant for inside such a sandbox.

  ```sh
  DEEPSEEK_API_KEY=… maka-lab run examples/fix-add.spec.json --out /tmp/out
  ```

## Grading

Verification runs the task's `command` in the workspace; exit code 0 = pass.
To stop a config from grading itself, list the test/grading files in
`verification.protectedPaths`: they are restored from the pristine fixture
*after* the agent finishes and *before* the command runs, so a model that
rewrote its own test to pass has that edit reverted. `examples/fix-add`
protects `test.mjs` — the model may edit `src.mjs`, never the test that
grades it.

## Scope

MVP. Deliberately later, as pure additions: parallel matrix execution,
LLM/rule evaluators (today: exit-code of a command), Docker/network
isolation, SWE-bench pack ingestion, and a richer report than the markdown
grid. Promote the contracts into `@maka/core` once a second consumer exists.
