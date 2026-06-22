#!/usr/bin/env node
/**
 * Dev HMR launcher: run the Vite dev server and point Electron at it so
 * renderer edits (apps/desktop/src/renderer/**) hot-reload without a
 * rebuild. The main process already honors `VITE_DEV_SERVER_URL`
 * (apps/desktop/src/main/main.ts) — it `loadURL`s the dev server when
 * the env var is set, otherwise it `loadFile`s the built renderer.
 *
 * Prerequisite builds (workspace libs + main + preload) are run by the
 * `dev:hmr` npm script BEFORE this launcher; this file only orchestrates
 * the two long-running processes and their teardown.
 *
 * Scope: HMR covers the desktop renderer only. Main/preload changes are
 * not hot-reloadable (Electron restart required), and edits to the
 * shared `@maka/*` packages need that package rebuilt — neither is a
 * Vite concern.
 *
 * Extra CLI args are forwarded to Electron, e.g.
 *   node scripts/dev-hmr.mjs -- --remote-debugging-port=9230
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DESKTOP_DIR = join(REPO_ROOT, 'apps', 'desktop');

// Walk up from the desktop package to find the nearest `node_modules/.bin/<name>`.
// In a git worktree, third-party binaries live in the main checkout's
// node_modules (an ancestor dir), not the worktree's own — so a hardcoded
// path under REPO_ROOT misses them.
function resolveBin(name) {
  let dir = DESKTOP_DIR;
  for (;;) {
    const candidate = join(dir, 'node_modules', '.bin', name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return name; // fall back to PATH
    dir = parent;
  }
}

const VITE_BIN = resolveBin('vite');
const ELECTRON_BIN = resolveBin('electron');
const EXTRA_ELECTRON_ARGS = process.argv.slice(2);
const STARTUP_TIMEOUT_MS = 60_000;
// Vite prints e.g. "  ➜  Local:   http://localhost:5173/"; capture the
// actual port since Vite falls forward when 5173 is taken.
const DEV_URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)\/?/i;

let electron = null;
let started = false;
let shuttingDown = false;

const vite = spawn(VITE_BIN, [], { cwd: DESKTOP_DIR, stdio: ['ignore', 'pipe', 'inherit'] });
vite.on('error', (err) => {
  console.error(`[dev:hmr] failed to start vite (${VITE_BIN}): ${err.message}`);
  shutdown(1);
});

const startupTimeout = setTimeout(() => {
  if (!started) {
    console.error('[dev:hmr] vite did not report a dev URL within 60s; aborting.');
    shutdown(1);
  }
}, STARTUP_TIMEOUT_MS);

vite.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text); // surface Vite logs to the user
  if (started) return;
  const match = DEV_URL_RE.exec(text);
  if (match) {
    started = true;
    clearTimeout(startupTimeout);
    launchElectron(match[1]);
  }
});

vite.on('exit', (code) => {
  if (!shuttingDown) {
    console.error('[dev:hmr] vite exited unexpectedly; stopping.');
    shutdown(code ?? 1);
  }
});

function launchElectron(devUrl) {
  console.log(`[dev:hmr] vite ready at ${devUrl} — launching Electron (renderer HMR live)`);
  electron = spawn(ELECTRON_BIN, ['.', ...EXTRA_ELECTRON_ARGS], {
    cwd: DESKTOP_DIR,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl },
  });
  electron.on('error', (err) => {
    console.error(`[dev:hmr] failed to start electron (${ELECTRON_BIN}): ${err.message}`);
    shutdown(1);
  });
  electron.on('exit', (code) => {
    console.log(`[dev:hmr] Electron exited (${code ?? 0}); stopping vite.`);
    shutdown(code ?? 0);
  });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (electron && !electron.killed) electron.kill('SIGTERM');
  if (vite && !vite.killed) vite.kill('SIGTERM');
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
