// packages/runtime/src/builtin-tools.ts
// Phase 1 baseline tool set. Each tool returned as MakaTool[] so
// wrapToolExecute can decorate with permission round-trip + tool_call/tool_result write.
//
// Read / Glob / Grep auto-approve.
// Bash / Write / Edit go through PermissionEngine.

import { z } from 'zod';
import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { glob as nodeGlob } from 'node:fs/promises'; // Node 22+ stable glob
import { resolve } from 'node:path';

// Single source of truth for tool shape. AiSdkBackend exports them; we just
// re-export here for back-compat with external callers that imported from
// builtin-tools directly.
import type { MakaTool, MakaToolContext } from './ai-sdk-backend.js';
export type { MakaTool, MakaToolContext };

const execAsync = promisify(exec);

export function buildBuiltinTools(): MakaTool[] {
  return [
    {
      name: 'Bash',
      description: 'Run a shell command in the session cwd. Subject to permission policy.',
      parameters: z.object({
        command: z.string().describe('The shell command to execute'),
        timeout_ms: z.number().int().positive().max(600_000).optional(),
      }),
      permissionRequired: true,
      impl: async ({ command, timeout_ms }, { cwd, abortSignal }) => {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout: timeout_ms ?? 120_000,
          signal: abortSignal,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { stdout, stderr };
      },
    },
    {
      name: 'Read',
      description: 'Read a file from disk by absolute path (or relative to session cwd).',
      parameters: z.object({
        path: z.string(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional(),
      }),
      permissionRequired: false,
      impl: async ({ path, offset, limit }, { cwd }) => {
        const abs = resolve(cwd, path);
        const content = await fs.readFile(abs, 'utf8');
        if (offset === undefined && limit === undefined) return { content };
        const lines = content.split('\n');
        const start = offset ?? 0;
        const end = limit ? start + limit : lines.length;
        return { content: lines.slice(start, end).join('\n') };
      },
    },
    {
      name: 'Write',
      description: 'Write content to a file (creates or overwrites). Subject to permission policy.',
      parameters: z.object({ path: z.string(), content: z.string() }),
      permissionRequired: true,
      impl: async ({ path, content }, { cwd }) => {
        const abs = resolve(cwd, path);
        await fs.writeFile(abs, content, 'utf8');
        return { ok: true, path: abs, bytes: Buffer.byteLength(content, 'utf8') };
      },
    },
    {
      name: 'Edit',
      description:
        'Replace an exact string in a file. Errors if old_string is not unique or not found.',
      parameters: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
      }),
      permissionRequired: true,
      impl: async ({ path, old_string, new_string }, { cwd }) => {
        const abs = resolve(cwd, path);
        const current = await fs.readFile(abs, 'utf8');
        const count = current.split(old_string).length - 1;
        if (count === 0) throw new Error(`old_string not found in ${path}`);
        if (count > 1) {
          throw new Error(`old_string is not unique in ${path} (${count} matches)`);
        }
        const next = current.replace(old_string, new_string);
        await fs.writeFile(abs, next, 'utf8');
        return { ok: true, path: abs, replacements: 1 };
      },
    },
    {
      name: 'Glob',
      description:
        'Find files matching a glob pattern (case-insensitive, capped at 200, sorted by walk order).',
      parameters: z.object({
        pattern: z.string(),
        cwd: z.string().optional(),
      }),
      permissionRequired: false,
      impl: async ({ pattern, cwd: relCwd }, { cwd }) => {
        const base = relCwd ? resolve(cwd, relCwd) : cwd;
        const files: string[] = [];
        for await (const f of nodeGlob(pattern, { cwd: base })) {
          files.push(typeof f === 'string' ? f : (f as any).name);
          if (files.length >= 200) break;
        }
        return { files };
      },
    },
    {
      name: 'Grep',
      description: 'Search file contents with a regex via ripgrep.',
      parameters: z.object({
        pattern: z.string(),
        path: z.string().optional(),
        glob: z.string().optional(),
      }),
      permissionRequired: false,
      impl: async ({ pattern, path, glob }, { cwd }) => {
        const args = ['-n', '--no-heading', '--max-count=50'];
        if (glob) args.push('--glob', glob);
        args.push(pattern);
        if (path) args.push(resolve(cwd, path));
        else args.push(cwd);
        const cmd = `rg ${args.map(shellEscape).join(' ')}`;
        try {
          const { stdout } = await execAsync(cmd, {
            cwd,
            maxBuffer: 5 * 1024 * 1024,
          });
          return { matches: stdout.split('\n').filter(Boolean).slice(0, 200) };
        } catch (e: any) {
          if (e?.code === 1) return { matches: [] }; // ripgrep "no match"
          throw e;
        }
      },
    },
  ];
}

function shellEscape(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}
