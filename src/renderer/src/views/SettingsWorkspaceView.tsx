import type { AppShellState, InventorySourceMode, SettingsState, SkillInventorySnapshot } from '@shared/contracts';
import type { FormEvent, ReactNode } from 'react';
import { Folder, Lock, Plus, Star, X } from 'lucide-react';

import type { PendingInventoryOperation } from '../lib/pending-inventory-operation';
import {
  PageTopBar,
  RescanToolbarButton,
  StaticSwitch,
  ToolbarButton,
} from '../components/ui';

export function SettingsWorkspaceView({
  addActionControl,
  customScanPathInput,
  devToolsEnabled,
  handleAddCustomScanPath,
  handleClearPreferredCanonicalSourcePath,
  handleInventorySourceModeChange,
  handleRemoveCustomScanPath,
  handleSetDevSidebarInventorySourceSwitcherVisible,
  handleSetPreferredCanonicalSourcePath,
  handleSetPreferredCanonicalSourcePathValue,
  handleSeedRepresentativeFixtures,
  inventorySourceMode,
  isRescanning,
  isSeedingFixtures,
  isSwitchingInventorySource,
  isUpdatingSettings,
  inventorySnapshot,
  onOpenOnboarding,
  onCancelMcpConnectivityTest,
  onRescan,
  pendingInventoryOperation,
  preferredCanonicalSourcePathInput,
  settingsState,
  setCustomScanPathInput,
  setPreferredCanonicalSourcePathInput,
  shellState,
}: {
  addActionControl?: ReactNode;
  customScanPathInput: string;
  devToolsEnabled: boolean;
  handleAddCustomScanPath: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleClearPreferredCanonicalSourcePath: () => Promise<void>;
  handleInventorySourceModeChange: (mode: InventorySourceMode) => Promise<void>;
  handleRemoveCustomScanPath: (scanPath: string) => Promise<void>;
  handleSetDevSidebarInventorySourceSwitcherVisible: (visible: boolean) => Promise<void>;
  handleSetPreferredCanonicalSourcePath: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleSetPreferredCanonicalSourcePathValue: (scanPath: string) => Promise<void>;
  handleSeedRepresentativeFixtures: () => Promise<void>;
  inventorySourceMode: InventorySourceMode;
  isRescanning: boolean;
  isSeedingFixtures: boolean;
  isSwitchingInventorySource: boolean;
  isUpdatingSettings: boolean;
  inventorySnapshot: SkillInventorySnapshot | null;
  onOpenOnboarding: () => void;
  onCancelMcpConnectivityTest?: () => void;
  onRescan: () => Promise<void>;
  pendingInventoryOperation: PendingInventoryOperation | null;
  preferredCanonicalSourcePathInput: string;
  settingsState: SettingsState;
  setCustomScanPathInput: (value: string) => void;
  setPreferredCanonicalSourcePathInput: (value: string) => void;
  shellState: AppShellState | null;
}) {
  const isDevelopmentBusy = isSwitchingInventorySource || isUpdatingSettings || isSeedingFixtures;
  const customScanPendingOperation = pendingInventoryOperation?.area === 'scan-paths' ? pendingInventoryOperation : null;
  const developmentPendingOperation = pendingInventoryOperation?.area === 'development' ? pendingInventoryOperation : null;
  const scanPathRows = buildScanPathRows(settingsState, inventorySnapshot);

  return (
    <main className="workspace-view">
      <PageTopBar
        actions={(
          <div className="header-action-cluster">
            <RescanToolbarButton isRescanning={isRescanning} onCancel={onCancelMcpConnectivityTest} onRescan={onRescan} />
            {addActionControl}
          </div>
        )}
        title="Settings"
      />

      <div className="page-scroll">
        <div className="settings-card-stack">
          <section className="settings-card">
            <SettingsGroupHeader
              description="How Skill Index discovers and watches skills on this machine."
              title="Scanning"
            />
            <SettingsValueRow
              description="Fallback universal home for skills with no preferred canonical source. Set by Skill Index - read-only."
              label="Universal location"
              trailing={(
                <span className="settings-mono-pill">
                  <Lock aria-hidden="true" size={12} />
                  {inventorySourceMode === 'sandbox' && devToolsEnabled
                    ? shellState?.devTools?.sandboxAgentsSkillsDir ?? '~/.agents/skills'
                    : shellState?.liveCanonicalUserSkillsDir ?? '~/.agents/skills'}
                </span>
              )}
            />
            <SettingsValueRow
              description="Re-index automatically when skills or configs change on disk."
              label="Watch files for changes"
              trailing={<StaticSwitch active />}
            />
            <SettingsValueRow
              description="Run the same inventory refresh that the Rescan button runs when Skill Index opens."
              label="Rescan when Skill Index opens"
              trailing={<StaticSwitch active />}
            />
          </section>

          <section className="settings-card">
            <SettingsGroupHeader
              description="Extra directories to include when looking for skills. Mark one as canonical - agents read from it directly and other installs link to it."
              title="Custom scan paths"
            />
            {customScanPendingOperation ? <SettingsPendingBanner operation={customScanPendingOperation} /> : null}
            <div className="settings-path-table">
              {scanPathRows.length > 0 ? (
                <div className="settings-path-table-header" aria-hidden="true">
                  <span />
                  <span>Path</span>
                  <span>Skills</span>
                  <span>Canonical</span>
                  <span />
                </div>
              ) : null}

              {scanPathRows.map((row) => (
                <div className={`settings-path-row${row.isCanonical ? ' settings-path-row--canonical' : ''}`} key={row.path}>
                  <span className="settings-path-icon" aria-hidden="true">
                    {row.isCanonical ? <Star fill="currentColor" size={14} /> : <Folder size={14} />}
                  </span>
                  <code className="settings-path-value" title={row.path}>{row.path}</code>
                  <span className="settings-path-count">{row.skillCount}</span>
                  {row.isCanonical ? (
                    <button
                      aria-label={row.path}
                      className="settings-canonical-button settings-canonical-button--active"
                      disabled={isUpdatingSettings}
                      type="button"
                      onClick={() => {
                        void handleClearPreferredCanonicalSourcePath();
                      }}
                    >
                      <Star aria-hidden="true" fill="currentColor" size={11} />
                      Canonical
                    </button>
                  ) : (
                    <button
                      className="settings-canonical-button"
                      disabled={isUpdatingSettings}
                      type="button"
                      onClick={() => {
                        void handleSetPreferredCanonicalSourcePathValue(row.path);
                      }}
                    >
                      <Star aria-hidden="true" size={11} />
                      Make canonical
                    </button>
                  )}
                  {row.isCustom ? (
                    <button
                      aria-label={row.path}
                      className="settings-path-remove"
                      disabled={isUpdatingSettings}
                      type="button"
                      onClick={() => {
                        void handleRemoveCustomScanPath(row.path);
                      }}
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  ) : (
                    <span className="settings-path-remove settings-path-remove--placeholder" aria-hidden="true" />
                  )}
                </div>
              ))}

              <form className="settings-inline-form settings-inline-form--paths" onSubmit={(event) => void handleAddCustomScanPath(event)}>
                <input
                  aria-label="Custom scan path"
                  className="settings-inline-input"
                  placeholder="~/repos/my-custom-skills-repo"
                  type="text"
                  value={customScanPathInput}
                  onChange={(event) => setCustomScanPathInput(event.target.value)}
                />
                <button
                  className="settings-small-button"
                  disabled={isUpdatingSettings || customScanPathInput.trim().length === 0}
                  type="submit"
                >
                  <Plus aria-hidden="true" size={12} />
                  {customScanPendingOperation?.kind === 'add-scan-path' ? 'Adding path...' : 'Add path...'}
                </button>
              </form>

              <form className="settings-inline-form settings-inline-form--canonical settings-compat-form" onSubmit={(event) => void handleSetPreferredCanonicalSourcePath(event)}>
                <input
                  aria-label="Preferred canonical source path"
                  className="settings-inline-input"
                  placeholder="~/repos/arjit-skills"
                  type="text"
                  value={preferredCanonicalSourcePathInput}
                  onChange={(event) => setPreferredCanonicalSourcePathInput(event.target.value)}
                />
                <button
                  className="settings-small-button settings-small-button--ghost"
                  disabled={isUpdatingSettings || preferredCanonicalSourcePathInput.trim().length === 0}
                  type="submit"
                >
                  Set preferred path...
                </button>
              </form>
            </div>
          </section>

          {devToolsEnabled ? (
            <section className="settings-card">
              <SettingsGroupHeader
                description="Session-only development controls."
                title="Development"
              />
              {developmentPendingOperation ? <SettingsPendingBanner operation={developmentPendingOperation} /> : null}
              <SettingsValueRow
                description="Choose whether this session scans the representative sandbox or your real machine."
                label="Inventory source"
                trailing={(
                  <div aria-label="Inventory source" className="settings-mode-toggle" role="radiogroup">
                    <InventorySourceOption
                      description="Representative fixtures"
                      disabled={isDevelopmentBusy}
                      isActive={inventorySourceMode === 'sandbox'}
                      label="Sandbox"
                      onSelect={() => {
                        void handleInventorySourceModeChange('sandbox');
                      }}
                    />
                    <InventorySourceOption
                      description="Actual Mac setup"
                      disabled={isDevelopmentBusy}
                      isActive={inventorySourceMode === 'live'}
                      label="Live"
                      onSelect={() => {
                        void handleInventorySourceModeChange('live');
                      }}
                    />
                  </div>
                )}
              />
              <SettingsValueRow
                description="Show the quick Sandbox/Live selector in the sidebar footer."
                label="Sidebar source switcher"
                trailing={(
                  <SettingsSwitchButton
                    active={settingsState.showDevSidebarInventorySourceSwitcher}
                    disabled={isDevelopmentBusy}
                    label="Show sidebar source switcher"
                    onClick={() => {
                      void handleSetDevSidebarInventorySourceSwitcherVisible(
                        !settingsState.showDevSidebarInventorySourceSwitcher,
                      );
                    }}
                  />
                )}
              />
              <SettingsValueRow
                description="Refresh the representative sandbox data used in development. This rewrites ~/.skillindex/sandbox from the bundled fixtures."
                label="Reset representative sandbox"
                trailing={(
                  <ToolbarButton
                    disabled={isDevelopmentBusy}
                    label={isSeedingFixtures ? 'Resetting...' : 'Run'}
                    subtle
                    onClick={() => {
                      void handleSeedRepresentativeFixtures();
                    }}
                  />
                )}
              />
              <SettingsValueRow
                description="Preview the first-run setup flow from this session without changing onboarding state until you finish it."
                label="Onboarding"
                trailing={(
                  <ToolbarButton
                    disabled={isDevelopmentBusy}
                    label="Open onboarding"
                    subtle
                    onClick={onOpenOnboarding}
                  />
                )}
              />
            </section>
          ) : null}
        </div>

      </div>
    </main>
  );
}

function SettingsPendingBanner({ operation }: { operation: PendingInventoryOperation }) {
  return (
    <div aria-live="polite" className="settings-pending-banner" role="status">
      <span className="settings-pending-spinner" aria-hidden="true" />
      <div>
        <strong>{operation.title}...</strong>
        <p>{operation.detail} Controls are paused while Skill Index updates state.</p>
      </div>
    </div>
  );
}

function SettingsGroupHeader({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="settings-card-header">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function SettingsValueRow({
  description,
  label,
  trailing,
}: {
  description: string;
  label: string;
  trailing: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <div className="settings-row-trailing">{trailing}</div>
    </div>
  );
}

function InventorySourceOption({
  description,
  disabled,
  isActive,
  label,
  onSelect,
}: {
  description: string;
  disabled: boolean;
  isActive: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-checked={isActive}
      className={`settings-mode-toggle-option${isActive ? ' settings-mode-toggle-option--active' : ''}`}
      disabled={disabled}
      role="radio"
      type="button"
      onClick={onSelect}
    >
      <span>{label}</span>
      <small>{description}</small>
    </button>
  );
}

function SettingsSwitchButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-checked={active}
      className="settings-switch-button"
      disabled={disabled}
      role="switch"
      type="button"
      onClick={onClick}
    >
      <StaticSwitch active={active} />
      <span>{label}</span>
    </button>
  );
}

function buildScanPathRows(settingsState: SettingsState, inventorySnapshot: SkillInventorySnapshot | null): Array<{
  isCanonical: boolean;
  isCustom: boolean;
  path: string;
  skillCount: number;
}> {
  const preferredCanonicalSourcePath = settingsState.preferredCanonicalSourcePath;
  const paths = new Map<string, { isCustom: boolean; path: string }>();

  for (const path of settingsState.customScanPaths) {
    paths.set(path, { isCustom: true, path });
  }

  if (preferredCanonicalSourcePath && !paths.has(preferredCanonicalSourcePath)) {
    paths.set(preferredCanonicalSourcePath, { isCustom: false, path: preferredCanonicalSourcePath });
  }

  return Array.from(paths.values())
    .map((row) => ({
      ...row,
      isCanonical: row.path === preferredCanonicalSourcePath,
      skillCount: countSkillsForScanPath(row.path, inventorySnapshot),
    }))
    .sort((first, second) => Number(second.isCanonical) - Number(first.isCanonical));
}

function countSkillsForScanPath(scanPath: string, inventorySnapshot: SkillInventorySnapshot | null): number {
  if (!inventorySnapshot) {
    return 0;
  }

  const matchingSourceIds = new Set(
    inventorySnapshot.sources
      .filter((source) => source.skillsDir === scanPath)
      .map((source) => source.id),
  );

  if (matchingSourceIds.size === 0) {
    return 0;
  }

  return inventorySnapshot.skills.filter((skill) =>
    skill.locations.some((location) => matchingSourceIds.has(location.sourceId))).length;
}
