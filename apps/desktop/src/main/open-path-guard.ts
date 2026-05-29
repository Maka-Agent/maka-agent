import { realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export type OpenPathKey = 'workspace' | 'skills' | 'memory';

export type OpenPathResult =
  | { ok: true; opened: OpenPathKey }
  | { ok: false; reason: OpenPathFailureReason };

export type OpenPathFailureReason =
  | 'unknown-key'
  | 'not-allowed'
  | 'missing'
  | 'not-a-directory'
  | 'open-failed';

export interface ResolveOpenPathInput {
  key: string;
  workspaceRoot: string;
}

const OPEN_PATHS: Record<OpenPathKey, (workspaceRoot: string) => string> = {
  workspace: (workspaceRoot) => workspaceRoot,
  skills: (workspaceRoot) => join(workspaceRoot, 'skills'),
  memory: (workspaceRoot) => join(workspaceRoot, 'memory'),
};

export async function resolveOpenPath(input: ResolveOpenPathInput): Promise<
  | { ok: true; key: OpenPathKey; path: string }
  | { ok: false; reason: OpenPathFailureReason }
> {
  if (!isOpenPathKey(input.key)) return { ok: false, reason: 'unknown-key' };

  const candidate = OPEN_PATHS[input.key](input.workspaceRoot);
  let root: string;
  let target: string;
  try {
    [root, target] = await Promise.all([
      realpath(input.workspaceRoot),
      realpath(candidate),
    ]);
  } catch {
    return { ok: false, reason: 'missing' };
  }

  if (!isInsideOrSamePath(root, target)) return { ok: false, reason: 'not-allowed' };

  const targetStat = await stat(target).catch(() => null);
  if (!targetStat) return { ok: false, reason: 'missing' };
  if (!targetStat.isDirectory()) return { ok: false, reason: 'not-a-directory' };

  return { ok: true, key: input.key, path: target };
}

function isOpenPathKey(value: string): value is OpenPathKey {
  return value === 'workspace' || value === 'skills' || value === 'memory';
}

function isInsideOrSamePath(root: string, target: string): boolean {
  if (target === root) return true;
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && rel !== '..' && !rel.includes(`..${sep}`) && !rel.startsWith(sep);
}
