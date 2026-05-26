/**
 * Shared types for the Command Palette. Pulled out of
 * `command-palette.tsx` so non-JSX modules
 * (`command-palette-content-search.ts`) can consume them under the
 * main-process tsconfig that does NOT compile JSX.
 */

import type { LucideIcon } from 'lucide-react';

export type CommandKind = 'action' | 'session';

export interface Command {
  id: string;
  kind: CommandKind;
  label: string;
  hint?: string;
  group: string;
  Icon: LucideIcon;
  keywords?: string[];
  run(): void;
}
