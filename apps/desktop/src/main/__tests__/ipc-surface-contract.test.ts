import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = process.cwd().endsWith('apps/desktop')
  ? join(process.cwd(), '..', '..')
  : process.cwd();

async function readRepo(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8');
}

function extractChannels(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]).sort();
}

describe('IPC surface contract', () => {
  it('keeps main handlers paired with preload invocations', async () => {
    const [main, preload] = await Promise.all([
      readRepo('apps/desktop/src/main/main.ts'),
      readRepo('apps/desktop/src/preload/preload.ts'),
    ]);
    const mainChannels = extractChannels(main, /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g);
    const preloadChannels = extractChannels(preload, /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g);
    const mainSet = new Set(mainChannels);
    const preloadSet = new Set(preloadChannels);
    const missingMainHandlers = preloadChannels.filter((channel) => !mainSet.has(channel));
    const staleMainHandlers = mainChannels.filter((channel) => !preloadSet.has(channel));

    assert.deepEqual(missingMainHandlers, [], 'every preload invoke channel must have a main handler');
    assert.deepEqual(staleMainHandlers, [], 'main process must not expose stale invoke handlers outside the preload bridge');
  });
});
