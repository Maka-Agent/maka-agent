import type { MakaTool, ToolAvailabilityConfig } from '@maka/runtime';
import {
  buildSubagentProjectionTools,
  buildSubagentSpawnTool,
} from '@maka/runtime';
import { posix as pathPosix } from 'node:path';
import { z } from 'zod';
import { buildHeavyTaskProgressTools, type HeavyTaskProgressRecorder } from './heavy-task-progress.js';
import { buildHeavyTaskSelfCheckTools, type HeavyTaskSelfCheckRecorder } from './heavy-task-self-check.js';
import type { IsolatedToolExecutor } from './isolation.js';

export interface BuildIsolatedHeadlessToolsOptions {
  heavyTaskProgress?: HeavyTaskProgressRecorder;
  heavyTaskSelfCheck?: HeavyTaskSelfCheckRecorder;
}

/**
 * Build Maka's standard headless tool surface with shell and file operations
 * routed through the isolated executor boundary.
 */
export function buildIsolatedHeadlessTools(
  executor: IsolatedToolExecutor,
  options: BuildIsolatedHeadlessToolsOptions = {},
): MakaTool[] {
  const tools = [
    buildIsolatedBashTool(executor),
    buildIsolatedReadTool(executor),
    buildIsolatedWriteTool(executor),
    buildIsolatedEditTool(executor),
    buildIsolatedGlobTool(executor),
    buildIsolatedGrepTool(executor),
    buildSubagentSpawnTool(),
    ...buildSubagentProjectionTools(),
  ];
  if (options.heavyTaskProgress) {
    tools.push(...buildHeavyTaskProgressTools(options.heavyTaskProgress));
  }
  if (options.heavyTaskSelfCheck) {
    tools.push(...buildHeavyTaskSelfCheckTools(options.heavyTaskSelfCheck));
  }
  return tools;
}

export function buildIsolatedHeadlessToolAvailability(): ToolAvailabilityConfig {
  return {
    economy: true,
    groups: [{
      id: 'agent',
      label: 'Agent',
      description: 'Spawn and inspect foreground child agents.',
      toolNames: ['agent_spawn', 'agent_list', 'agent_output'],
    }],
  };
}

export function buildIsolatedBashTool(executor: IsolatedToolExecutor): MakaTool {
  return {
    name: 'Bash',
    description: 'Run a shell command in the isolated headless task workspace.',
    parameters: z.object({
      command: z.string().describe('The shell command to execute'),
      timeout_ms: z.number().int().positive().max(600_000).optional(),
    }),
    permissionRequired: true,
    impl: async ({ command, timeout_ms }, { cwd, emitOutput }) => {
      const result = await executor.exec({
        command,
        cwd,
        timeoutMs: timeout_ms ?? 120_000,
      });
      if (result.stdout) emitOutput('stdout', result.stdout);
      if (result.stderr) emitOutput('stderr', result.stderr);
      return {
        kind: 'terminal',
        cwd,
        cmd: command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };
}

export function buildIsolatedReadTool(executor: IsolatedToolExecutor): MakaTool {
  return {
    name: 'Read',
    description: 'Read a file from the isolated headless task workspace.',
    parameters: z.object({
      path: z.string(),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
    }),
    permissionRequired: false,
    impl: async ({ path, offset, limit }, { cwd }) => {
      const normalizedPath = normalizeWorkspacePath(path, cwd, 'Read path');
      if (executor.readFile) return await executor.readFile({ cwd, path: normalizedPath, offset, limit });
      const stdout = await execFileCommand(executor, cwd, shellFileCommand(READ_SCRIPT, [
        normalizedPath,
        numberArg(offset),
        numberArg(limit),
      ]));
      return { content: stdout };
    },
  };
}

export function buildIsolatedWriteTool(executor: IsolatedToolExecutor): MakaTool {
  return {
    name: 'Write',
    description: 'Write content to a file in the isolated headless task workspace.',
    parameters: z.object({ path: z.string(), content: z.string() }),
    permissionRequired: true,
    impl: async ({ path, content }, { cwd }) => {
      const normalizedPath = normalizeWorkspacePath(path, cwd, 'Write path');
      if (executor.writeFile) return await executor.writeFile({ cwd, path: normalizedPath, content });
      await execFileCommand(executor, cwd, shellFileCommand(WRITE_SCRIPT, [
        normalizedPath,
        content,
      ]));
      return { ok: true, path: normalizedPath, bytes: Buffer.byteLength(content, 'utf8') };
    },
  };
}

export function buildIsolatedEditTool(executor: IsolatedToolExecutor): MakaTool {
  return {
    name: 'Edit',
    description: 'Replace an exact string in a file in the isolated headless task workspace.',
    parameters: z.object({
      path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
    }),
    permissionRequired: true,
    impl: async ({ path, old_string, new_string }, { cwd }) => {
      const normalizedPath = normalizeWorkspacePath(path, cwd, 'Edit path');
      if (executor.editFile) {
        return await executor.editFile({ cwd, path: normalizedPath, oldString: old_string, newString: new_string });
      }
      await execFileCommand(executor, cwd, shellFileCommand(EDIT_SCRIPT, [
        normalizedPath,
        old_string,
        new_string,
      ]));
      return { ok: true, path: normalizedPath, replacements: 1 };
    },
  };
}

export function buildIsolatedGlobTool(executor: IsolatedToolExecutor): MakaTool {
  return {
    name: 'Glob',
    description: 'Find files in the isolated headless task workspace matching a glob pattern.',
    parameters: z.object({
      pattern: z.string(),
      cwd: z.string().optional(),
    }),
    permissionRequired: false,
    impl: async ({ pattern, cwd: relCwd }, { cwd }) => {
      const normalizedPattern = normalizeWorkspaceGlobPattern(pattern, cwd, 'Glob pattern');
      const normalizedRelCwd = relCwd === undefined ? undefined : normalizeWorkspacePath(relCwd, cwd, 'Glob cwd');
      if (executor.globFiles) return await executor.globFiles({ cwd, pattern: normalizedPattern, searchCwd: normalizedRelCwd });
      const stdout = await execFileCommand(executor, cwd, shellFileCommand(GLOB_SCRIPT, [
        normalizedPattern,
        globPatternToEre(normalizedPattern),
        normalizedRelCwd ?? '',
      ]));
      return { files: parseLineArray(stdout) };
    },
  };
}

export function buildIsolatedGrepTool(executor: IsolatedToolExecutor): MakaTool {
  return {
    name: 'Grep',
    description: 'Search file contents with a regex in the isolated headless task workspace.',
    parameters: z.object({
      pattern: z.string(),
      path: z.string().optional(),
      glob: z.string().optional(),
    }),
    permissionRequired: false,
    impl: async ({ pattern, path, glob }, { cwd }) => {
      const normalizedPath = path === undefined ? undefined : normalizeWorkspacePath(path, cwd, 'Grep path');
      const normalizedGlob = glob === undefined ? undefined : normalizeWorkspaceGlobPattern(glob, cwd, 'Grep glob');
      if (executor.grepFiles) return await executor.grepFiles({
        cwd,
        pattern,
        path: normalizedPath,
        glob: normalizedGlob,
      });
      const stdout = await execFileCommand(executor, cwd, shellFileCommand(GREP_SCRIPT, [
        pattern,
        normalizedPath ?? '',
        normalizedGlob ?? '',
        normalizedGlob === undefined ? '' : globPatternToEre(normalizedGlob),
      ]));
      return { matches: parseLineArray(stdout) };
    },
  };
}

async function execFileCommand(executor: IsolatedToolExecutor, cwd: string, command: string): Promise<string> {
  const result = await executor.exec({ command, cwd, timeoutMs: 120_000 });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `isolated file command failed with exit code ${result.exitCode}`);
  }
  return result.stdout;
}

function shellFileCommand(script: string, args: string[]): string {
  return ['sh', '-c', shellQuote(script), '--', ...args.map(shellQuote)].join(' ');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function numberArg(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function parseLineArray(stdout: string): string[] {
  if (!stdout) return [];
  return stdout.replace(/\n$/, '').split('\n').filter((line) => line.length > 0);
}

function globPatternToEre(pattern: string): string {
  let output = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === '*' && next === '*') {
      output += '.*';
      i += 1;
    } else if (ch === '*') {
      output += '[^/]*';
    } else if (ch === '?') {
      output += '[^/]';
    } else {
      output += escapeEreChar(ch);
    }
  }
  return `${output}$`;
}

function escapeEreChar(ch: string): string {
  return /[\\.^$+{}()[\]|]/.test(ch) ? `\\${ch}` : ch;
}

function normalizeWorkspacePath(inputPath: string, cwd: string, label: string): string {
  assertNoDriveOrParentSegment(inputPath, label);
  if (inputPath.startsWith('/')) {
    return assertNormalizedRelativePath(
      pathPosix.relative(normalizeWorkspaceRoot(cwd), pathPosix.normalize(inputPath)) || '.',
      label,
    );
  }
  return assertNormalizedRelativePath(inputPath, label);
}

function normalizeWorkspaceGlobPattern(pattern: string, cwd: string, label: string): string {
  assertNoDriveOrParentSegment(pattern, label);
  if (!pattern.startsWith('/')) return assertNormalizedRelativePath(pattern, label);
  return assertNormalizedRelativePath(pathPosix.relative(normalizeWorkspaceRoot(cwd), pattern) || '.', label);
}

function normalizeWorkspaceRoot(cwd: string): string {
  return pathPosix.normalize(cwd);
}

function assertNoDriveOrParentSegment(inputPath: string, label: string): void {
  if (
    inputPath.length === 0
    || /^[A-Za-z]:[\\/]/.test(inputPath)
    || inputPath.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`${label} must stay inside the isolated workspace`);
  }
}

function assertNormalizedRelativePath(inputPath: string, label: string): string {
  if (
    inputPath.length === 0
    || inputPath.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(inputPath)
    || inputPath.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`${label} must stay inside the isolated workspace`);
  }
  return inputPath;
}

const COMMON_SHELL_HELPERS = String.raw`
fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

inside_workspace() {
  case "$root" in
    /)
      case "$1" in /*) return 0 ;; esac
      ;;
    *)
      case "$1" in "$root"|"$root"/*) return 0 ;; esac
      ;;
  esac
  return 1
}

existing_target() {
  input_path=$1
  label=$2
  target=$root/$input_path
  [ -L "$target" ] && fail "$label must stay inside workspace"
  [ -e "$target" ] || fail "$label does not exist: $input_path"
  if [ -d "$target" ]; then
    real=$(cd -P "$target" 2>/dev/null && pwd -P) || fail "$label must stay inside workspace"
  else
    parent=$(dirname "$target")
    base=$(basename "$target")
    parent_real=$(cd -P "$parent" 2>/dev/null && pwd -P) || fail "$label must stay inside workspace"
    real=$parent_real/$base
  fi
  inside_workspace "$real" || fail "$label must stay inside workspace"
  printf '%s\n' "$real"
}

writable_target() {
  input_path=$1
  label=$2
  target=$root/$input_path
  parent=$(dirname "$target")
  base=$(basename "$target")
  parent_real=$(cd -P "$parent" 2>/dev/null && pwd -P) || fail "$label must stay inside workspace"
  inside_workspace "$parent_real" || fail "$label must stay inside workspace"
  real=$parent_real/$base
  [ -L "$real" ] && fail "$label must stay inside workspace"
  printf '%s\n' "$real"
}
`;

const READ_SCRIPT = `${COMMON_SHELL_HELPERS}
root=$(pwd -P) || exit 1
target=$(existing_target "$1" 'Read path') || exit 1
offset=$2
limit=$3
if [ -z "$offset" ] && [ -z "$limit" ]; then
  cat "$target"
else
  awk -v start="\${offset:-0}" -v limit="$limit" '
    BEGIN { first = start + 1; last = limit == "" ? 0 : start + limit; wrote = 0 }
    NR >= first && (last == 0 || NR <= last) {
      if (wrote) printf "\\n"
      printf "%s", $0
      wrote = 1
    }
  ' "$target"
fi
`;

const WRITE_SCRIPT = `${COMMON_SHELL_HELPERS}
root=$(pwd -P) || exit 1
target=$(writable_target "$1" 'Write path') || exit 1
printf '%s' "$2" > "$target"
`;

const EDIT_SCRIPT = `${COMMON_SHELL_HELPERS}
root=$(pwd -P) || exit 1
target=$(existing_target "$1" 'Edit path') || exit 1
tmp=$(mktemp "$target.maka-edit.XXXXXX") || exit 1
perl -0 -e '
  use strict;
  use warnings;
  my ($old, $new, $target, $tmp) = @ARGV;
  die "old_string must not be empty\n" if $old eq "";
  open my $in, "<:raw", $target or die "$target: $!\n";
  local $/;
  my $content = <$in>;
  close $in;
  my $count = () = $content =~ /\\Q$old\\E/g;
  die "old_string not found in $target\n" if $count == 0;
  die "old_string is not unique in $target ($count matches)\n" if $count > 1;
  $content =~ s/\\Q$old\\E/$new/;
  open my $out, ">:raw", $tmp or die "$tmp: $!\n";
  print {$out} $content;
  close $out;
' "$2" "$3" "$target" "$tmp"
rc=$?
if [ "$rc" -ne 0 ]; then
  rm -f "$tmp"
  exit "$rc"
fi
mv "$tmp" "$target"
`;

const GLOB_SCRIPT = `${COMMON_SHELL_HELPERS}
root=$(pwd -P) || exit 1
pattern=$1
pattern_re=$2
search_cwd=$3
if [ -n "$search_cwd" ]; then
  base=$(existing_target "$search_cwd" 'Glob cwd') || exit 1
else
  base=$root
fi
find "$base" -type f -print | awk -v root="$root" -v re="$pattern_re" '
  BEGIN { prefix = root "/"; count = 0 }
  {
    rel = $0
    if (index(rel, prefix) == 1) rel = substr(rel, length(prefix) + 1)
    if (rel ~ re) {
      print rel
      count += 1
      if (count >= 200) exit
    }
  }
'
`;

const GREP_SCRIPT = `${COMMON_SHELL_HELPERS}
root=$(pwd -P) || exit 1
grep_pattern=$1
input_path=$2
glob_re=$4
if [ -n "$input_path" ]; then
  start=$(existing_target "$input_path" 'Grep path') || exit 1
else
  start=$root
fi
if [ -f "$start" ]; then
  file_list=$start
else
  file_list=$(find "$start" -type f -print)
fi
printf '%s\n' "$file_list" | while IFS= read -r file; do
  [ -n "$file" ] || continue
  rel=$file
  prefix=$root/
  case "$rel" in "$prefix"*) rel=\${rel#"$prefix"} ;; esac
  if [ -n "$glob_re" ]; then
    printf '%s\n' "$rel" | awk -v re="$glob_re" 'BEGIN { ok = 1 } $0 ~ re { ok = 0 } END { exit ok }' || continue
  fi
  awk -v rel="$rel" -v pattern="$grep_pattern" '
    $0 ~ pattern {
      print rel ":" NR ":" $0
      count += 1
      if (count >= 50) exit
    }
  ' "$file"
done | awk 'NR <= 200'
`;
