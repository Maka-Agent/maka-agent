import { basename, join, relative } from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';

export const MAX_IMPORTED_TEXT_FILE_BYTES = 200_000;
export const MAX_IMPORTED_TEXT_FILE_CHARS = 20_000;
export const MAX_IMPORTED_TEXT_FILE_COUNT = 5;
export const MAX_IMPORTED_TEXT_FILES_CHARS = 40_000;
export const MAX_IMPORTED_FOLDER_ENTRIES = 200;
export const MAX_IMPORTED_FOLDER_DEPTH = 4;

const FOLDER_OUTLINE_SKIP_NAMES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'dist',
  'build',
  'coverage',
  'node_modules',
]);

export type TextFileImportFailureReason =
  | 'missing'
  | 'too-large'
  | 'binary'
  | 'too-many-files'
  | 'read-failed';

export type TextFileImportResult =
  | {
      ok: true;
      name: string;
      bytes: number;
      files: number;
      truncated: boolean;
      prompt: string;
    }
  | {
      ok: false;
      reason: TextFileImportFailureReason;
    };

export type FolderOutlineImportFailureReason =
  | 'missing'
  | 'read-failed'
  | 'empty';

export type FolderOutlineImportResult =
  | {
      ok: true;
      name: string;
      entries: number;
      truncated: boolean;
      prompt: string;
    }
  | {
      ok: false;
      reason: FolderOutlineImportFailureReason;
    };

export async function readTextFileForPromptImport(filePath: string): Promise<TextFileImportResult> {
  const loaded = await loadTextFileForPromptImport(filePath);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    name: loaded.name,
    bytes: loaded.bytes,
    files: 1,
    truncated: loaded.truncated,
    prompt: formatImportedTextFilePrompt({ name: loaded.name, text: loaded.text, truncated: loaded.truncated }),
  };
}

export async function readTextFilesForPromptImport(filePaths: string[]): Promise<TextFileImportResult> {
  const selected = filePaths.filter(Boolean);
  if (selected.length === 0) return { ok: false, reason: 'missing' };
  if (selected.length === 1) return readTextFileForPromptImport(selected[0]);
  if (selected.length > MAX_IMPORTED_TEXT_FILE_COUNT) return { ok: false, reason: 'too-many-files' };

  const loadedFiles = [];
  for (const filePath of selected) {
    const loaded = await loadTextFileForPromptImport(filePath);
    if (!loaded.ok) return loaded;
    loadedFiles.push(loaded);
  }

  let remaining = MAX_IMPORTED_TEXT_FILES_CHARS;
  let truncated = false;
  const fragments: string[] = [];
  for (const file of loadedFiles) {
    const chars = Array.from(file.text);
    const text = chars.length > remaining ? chars.slice(0, Math.max(0, remaining)).join('') : file.text;
    remaining -= Array.from(text).length;
    truncated = truncated || file.truncated || chars.length > Array.from(text).length || remaining <= 0;
    fragments.push(formatImportedTextFileBlock({ name: file.name, text, truncated: file.truncated || chars.length > Array.from(text).length }));
    if (remaining <= 0) break;
  }

  const totalBytes = loadedFiles.reduce((sum, file) => sum + file.bytes, 0);
  return {
    ok: true,
    name: `${loadedFiles.length} 个文本文件`,
    bytes: totalBytes,
    files: loadedFiles.length,
    truncated,
    prompt: formatImportedTextFilesPrompt({
      count: loadedFiles.length,
      fragments: fragments.join('\n\n'),
      truncated,
    }),
  };
}

async function loadTextFileForPromptImport(filePath: string): Promise<
  | {
      ok: true;
      name: string;
      bytes: number;
      text: string;
      truncated: boolean;
    }
  | {
      ok: false;
      reason: TextFileImportFailureReason;
    }
> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!fileStat.isFile()) return { ok: false, reason: 'missing' };
  if (fileStat.size > MAX_IMPORTED_TEXT_FILE_BYTES) return { ok: false, reason: 'too-large' };

  let raw: Buffer;
  try {
    raw = await readFile(filePath);
  } catch {
    return { ok: false, reason: 'read-failed' };
  }
  if (looksBinary(raw)) return { ok: false, reason: 'binary' };

  const cleaned = raw.toString('utf8').replace(/\u0000/g, '').trim();
  if (!cleaned) return { ok: false, reason: 'binary' };

  const chars = Array.from(cleaned);
  const truncated = chars.length > MAX_IMPORTED_TEXT_FILE_CHARS;
  const text = truncated ? chars.slice(0, MAX_IMPORTED_TEXT_FILE_CHARS).join('') : cleaned;
  const name = basename(filePath);
  return {
    ok: true,
    name,
    bytes: fileStat.size,
    text,
    truncated,
  };
}

export function formatImportedTextFilePrompt(input: { name: string; text: string; truncated: boolean }): string {
  return [
    `请结合下面导入的本地文本文件 "${input.name}" 回答。`,
    input.truncated ? '文件内容过长，下面只包含前一部分。' : '',
    '',
    formatImportedTextFileBlock(input),
  ].filter(Boolean).join('\n');
}

export function formatImportedTextFilesPrompt(input: { count: number; fragments: string; truncated: boolean }): string {
  return [
    `请结合下面导入的 ${input.count} 个本地文本文件回答。`,
    input.truncated ? '文件内容过长，下面只包含前一部分。' : '',
    '',
    input.fragments,
  ].filter(Boolean).join('\n');
}

function formatImportedTextFileBlock(input: { name: string; text: string; truncated: boolean }): string {
  return [
    `<local-text-file name="${escapeXmlAttr(input.name)}"${input.truncated ? ' truncated="true"' : ''}>`,
    input.text,
    '</local-text-file>',
  ].join('\n');
}

export async function readFolderOutlineForPromptImport(folderPath: string): Promise<FolderOutlineImportResult> {
  let rootStat;
  try {
    rootStat = await stat(folderPath);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!rootStat.isDirectory()) return { ok: false, reason: 'missing' };

  const lines: string[] = [];
  let truncated = false;

  try {
    await scanFolderOutline({
      root: folderPath,
      dir: folderPath,
      depth: 0,
      lines,
      markTruncated: () => { truncated = true; },
    });
  } catch {
    return { ok: false, reason: 'read-failed' };
  }

  if (lines.length === 0) return { ok: false, reason: 'empty' };
  const name = basename(folderPath) || 'folder';
  return {
    ok: true,
    name,
    entries: lines.length,
    truncated,
    prompt: formatImportedFolderOutlinePrompt({ name, outline: lines.join('\n'), truncated }),
  };
}

export function formatImportedFolderOutlinePrompt(input: { name: string; outline: string; truncated: boolean }): string {
  return [
    `请结合下面导入的本地文件夹目录 "${input.name}" 回答。`,
    input.truncated ? '目录较大，下面只包含前一部分。' : '',
    '',
    `<local-folder-outline name="${escapeXmlAttr(input.name)}">`,
    input.outline,
    '</local-folder-outline>',
  ].filter(Boolean).join('\n');
}

async function scanFolderOutline(input: {
  root: string;
  dir: string;
  depth: number;
  lines: string[];
  markTruncated: () => void;
}): Promise<void> {
  if (input.lines.length >= MAX_IMPORTED_FOLDER_ENTRIES || input.depth >= MAX_IMPORTED_FOLDER_DEPTH) {
    input.markTruncated();
    return;
  }

  const entries = await readdir(input.dir, { withFileTypes: true });
  entries.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (input.lines.length >= MAX_IMPORTED_FOLDER_ENTRIES) {
      input.markTruncated();
      return;
    }
    if (entry.name.startsWith('.') || FOLDER_OUTLINE_SKIP_NAMES.has(entry.name)) continue;

    const absolute = join(input.dir, entry.name);
    const rel = relative(input.root, absolute).split(/[\\/]/).join('/');
    if (!rel || rel.startsWith('..')) continue;

    if (entry.isDirectory()) {
      input.lines.push(`${'  '.repeat(input.depth)}- ${rel}/`);
      await scanFolderOutline({
        root: input.root,
        dir: absolute,
        depth: input.depth + 1,
        lines: input.lines,
        markTruncated: input.markTruncated,
      });
    } else if (entry.isFile()) {
      input.lines.push(`${'  '.repeat(input.depth)}- ${rel}`);
    }
  }
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.02;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
