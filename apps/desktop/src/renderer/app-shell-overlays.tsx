import type {
  LlmConnection,
  PermissionRequestEvent,
  PermissionResponse,
  SettingsSection,
  ThemePalette,
  ThemePreference,
} from '@maka/core';
import { PermissionDialog, SearchModal } from '@maka/ui';
import { KeyboardHelpModal } from './keyboard-help';
import { CommandPalette } from './command-palette';
import { SettingsModal } from './settings/SettingsModal';
import { buildAppShellCommandList, type AppShellCommandListOptions } from './app-shell-command-actions';

type SearchModalProps = Parameters<typeof SearchModal>[0];

export function AppShellOverlays(props: {
  activePermission: PermissionRequestEvent | undefined;
  respondToPermission(response: PermissionResponse): void | Promise<void>;
  settingsOpen: boolean;
  connections: LlmConnection[];
  defaultConnection: string | null;
  refreshConnections(): Promise<void>;
  closeSettings(): void;
  themePref: ThemePreference;
  setThemePref(themePref: ThemePreference): void;
  themePalette: ThemePalette;
  setThemePalette(themePalette: ThemePalette): void;
  setUserLabel(userLabel: string): void;
  settingsRequestedSection: SettingsSection | undefined;
  onOpenDailyReview(): void;
  onOpenSettingsSession(sessionId: string): void;
  helpOpen: boolean;
  closeHelp(): void;
  searchModalOpen: boolean;
  closeSearchModal: SearchModalProps['onClose'];
  searchModalDeps: SearchModalProps['deps'];
  searchModalOnNavigate: NonNullable<SearchModalProps['onNavigateToSession']>;
  paletteOpen: boolean;
  closePalette(): void;
  paletteOnSelectSession(sessionId: string, turnId?: string): void;
  commandOptions: AppShellCommandListOptions;
}) {
  const {
    activePermission,
    closeHelp,
    closePalette,
    closeSearchModal,
    closeSettings,
    commandOptions,
    connections,
    defaultConnection,
    helpOpen,
    paletteOnSelectSession,
    paletteOpen,
    refreshConnections,
    respondToPermission,
    searchModalDeps,
    searchModalOnNavigate,
    searchModalOpen,
    settingsOpen,
    settingsRequestedSection,
    setThemePalette,
    setThemePref,
    setUserLabel,
    themePalette,
    themePref,
  } = props;

  return (
    <>
      {activePermission && (
        <PermissionDialog
          request={activePermission}
          onRespond={respondToPermission}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          connections={connections}
          defaultSlug={defaultConnection}
          onRefresh={refreshConnections}
          onClose={closeSettings}
          themePref={themePref}
          onThemeChange={setThemePref}
          themePalette={themePalette}
          onThemePaletteChange={setThemePalette}
          onUserLabelChange={setUserLabel}
          requestedSection={settingsRequestedSection}
          onOpenDailyReview={props.onOpenDailyReview}
          onOpenSession={props.onOpenSettingsSession}
        />
      )}
      {helpOpen && <KeyboardHelpModal onClose={closeHelp} />}
      {searchModalOpen && (
        <SearchModal
          onClose={closeSearchModal}
          deps={searchModalDeps}
          onNavigateToSession={searchModalOnNavigate}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          onClose={closePalette}
          onSelectSession={paletteOnSelectSession}
          commands={buildAppShellCommandList(commandOptions)}
        />
      )}
    </>
  );
}
