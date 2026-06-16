/**
 * Contract test against the pinned @jackwener/opencli release: every IPage
 * member the seven browser tools (and BrowserSession) call must exist on the
 * page object CDPBridge.connect() returns, and the bridge-level API
 * BrowserSession drives must exist on CDPBridge. A version bump that drops or
 * renames one of these fails here instead of at runtime in a user's session.
 *
 * Ported from PawWork (bun:test → node:test) — the same opencli major.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { CDPBridge } from '@jackwener/opencli/browser/cdp';
import { htmlToMarkdown } from '@jackwener/opencli/utils';

const EXPECTED_OPENCLI_VERSION = '1.8.4';

// page methods the tools map to + the ones BrowserSession itself uses.
const REQUIRED_PAGE_METHODS = [
  'goto',
  'snapshot',
  'click',
  'fillText',
  'pressKey',
  'wait',
  'evaluate',
  'getCurrentUrl',
] as const;

function installedOpencliVersion(): string {
  const require = createRequire(import.meta.url);
  // dist/src/browser/cdp.js -> climb three dirs to the package root.
  const cdpJs = require.resolve('@jackwener/opencli/browser/cdp');
  const pkgRoot = join(dirname(cdpJs), '..', '..', '..');
  return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version as string;
}

async function connectToFake(): Promise<{ page: Record<string, unknown>; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  // address() is null until the OS bind completes; reading it synchronously
  // races the listen and throws.
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const port = (wss.address() as { port: number }).port;
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const cmd = JSON.parse(String(data)) as { id: number };
      ws.send(JSON.stringify({ id: cmd.id, result: {} }));
    });
  });
  // wss.close() stops accepting but leaves accepted sockets open — an
  // un-terminated server socket keeps the node:test process alive after the
  // suite finishes. Terminate the live connections, then close the server.
  const shutdown = async (): Promise<void> => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  };
  const bridge = new CDPBridge();
  let page: Record<string, unknown>;
  try {
    page = (await bridge.connect({ cdpEndpoint: `ws://127.0.0.1:${port}/secret` })) as unknown as Record<
      string,
      unknown
    >;
  } catch (err) {
    // The caller only gets `close` on success; release the listener here or a
    // failed connect leaks the server into the rest of the test process.
    await shutdown();
    throw err;
  }
  return {
    page,
    close: async () => {
      await bridge.close();
      await shutdown();
    },
  };
}

describe('opencli contract', () => {
  it('is pinned to the expected release', () => {
    assert.equal(installedOpencliVersion(), EXPECTED_OPENCLI_VERSION);
  });

  it('CDPBridge exposes the bridge-level API BrowserSession uses', () => {
    const bridge = new CDPBridge();
    assert.equal(typeof bridge.connect, 'function');
    assert.equal(typeof bridge.close, 'function');
    assert.equal(typeof bridge.send, 'function');
    assert.equal(typeof bridge.waitForEvent, 'function');
  });

  it('the connected page implements every method the browser tools call', async () => {
    const { page, close } = await connectToFake();
    try {
      for (const method of REQUIRED_PAGE_METHODS) {
        assert.equal(typeof page[method], 'function', `missing required page method: ${method}`);
      }
    } finally {
      await close();
    }
  });

  it('htmlToMarkdown converts extracted page HTML', () => {
    const markdown = htmlToMarkdown("<h1>Title</h1><p>Body with <a href='https://example.com'>link</a>.</p>");
    assert.ok(markdown.includes('Title'));
    assert.ok(markdown.includes('[link](https://example.com)'));
  });
});
