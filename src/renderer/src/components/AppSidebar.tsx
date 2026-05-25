import type { KeyboardEvent } from 'react';

import { APP_NAME, type AutoUpdateStatus, type InventorySourceMode, type SkillInventorySnapshot } from '@shared/contracts';

import skillIndexMark from '../assets/skill-index-mark.svg';
import type { PrimaryTab } from '../inventory-view-model';
import type { PendingInventoryOperation } from '../lib/pending-inventory-operation';
import { NavIcon, type NavIconName } from './NavIcon';

export interface AppNavItem {
  badge?: number;
  icon: Extract<NavIconName, 'home' | 'skills' | 'mcps' | 'agents' | 'plugins'>;
  label: string;
  meta?: number;
  tab: Exclude<PrimaryTab, 'audit' | 'settings'>;
  tone?: 'attention';
}

export function AppSidebar({
  activeTab,
  appName,
  inventorySnapshot,
  lastScanLabel,
  navItems,
  autoUpdateStatus,
  devInventorySource,
  isInstallingUpdate = false,
  onInstallUpdate,
  onSelectTab,
}: {
  activeTab: PrimaryTab;
  appName?: string;
  autoUpdateStatus?: AutoUpdateStatus;
  devInventorySource?: {
    isBusy: boolean;
    mode: InventorySourceMode;
    onChange: (mode: InventorySourceMode) => void;
    pendingOperation?: PendingInventoryOperation | null;
  };
  inventorySnapshot: SkillInventorySnapshot | null;
  lastScanLabel: string;
  navItems: AppNavItem[];
  isInstallingUpdate?: boolean;
  onInstallUpdate: () => void;
  onSelectTab: (tab: PrimaryTab) => void;
}) {
  const updateButton = getUpdateButton(autoUpdateStatus, isInstallingUpdate);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark" aria-hidden="true">
            <img src={skillIndexMark} alt="" />
          </div>
          <div className="sidebar-brand-copy">
            <h1>{appName ?? APP_NAME}</h1>
          </div>
        </div>
      </div>

      <nav aria-label="Primary">
        <ul className="nav-list">
          {navItems.map((item) => (
            <li key={item.label}>
              <button
                aria-pressed={activeTab === item.tab}
                className={`nav-button${activeTab === item.tab ? ' nav-button--active' : ''}`}
                type="button"
                onClick={() => onSelectTab(item.tab)}
              >
                <span className="nav-button-main">
                  <span className="nav-icon-shell" aria-hidden="true">
                    <NavIcon icon={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </span>
                <span className="nav-button-trailing">
                  {item.badge ? <span className={`nav-badge nav-badge--${item.tone}`}>{item.badge}</span> : null}
                  {typeof item.meta === 'number' ? <span className="nav-secondary-count">{item.meta}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-footer">
        {devInventorySource ? (
          <section className={`sidebar-source-card sidebar-source-card--${devInventorySource.mode}`} aria-label="Current inventory source">
            <div className="sidebar-source-dev-badge">Dev mode only</div>
            <div className="sidebar-source-heading">
              <span>Inventory source</span>
              <strong>{devInventorySource.mode === 'sandbox' ? 'Sandbox' : 'Live'}</strong>
            </div>
            {devInventorySource.pendingOperation ? (
              <div className="sidebar-source-pending" role="status">
                <span className="sidebar-source-spinner" aria-hidden="true" />
                <div>
                  <strong>{devInventorySource.pendingOperation.title}...</strong>
                  <p>{devInventorySource.pendingOperation.detail}</p>
                </div>
              </div>
            ) : (
              <p className="sidebar-source-note">Visible only in dev builds.</p>
            )}
            <div className="sidebar-source-toggle" role="radiogroup" aria-label="Dev inventory source">
              <InventorySourceButton
                disabled={devInventorySource.isBusy}
                isActive={devInventorySource.mode === 'sandbox'}
                label="Sandbox"
                mode="sandbox"
                onKeyboardSelect={devInventorySource.onChange}
                onSelect={() => devInventorySource.onChange('sandbox')}
              />
              <InventorySourceButton
                disabled={devInventorySource.isBusy}
                isActive={devInventorySource.mode === 'live'}
                label="Live"
                mode="live"
                onKeyboardSelect={devInventorySource.onChange}
                onSelect={() => devInventorySource.onChange('live')}
              />
            </div>
          </section>
        ) : null}

        <nav aria-label="Secondary">
          <ul className="nav-list nav-list--secondary">
            <li>
              <button
                aria-pressed={activeTab === 'audit'}
                className={`settings-button${activeTab === 'audit' ? ' settings-button--active' : ''}`}
                type="button"
                onClick={() => onSelectTab('audit')}
              >
                <span className="nav-button-main">
                  <span>Audit Log</span>
                </span>
              </button>
            </li>
            <li>
              <button
                aria-pressed={activeTab === 'settings'}
                className={`settings-button${activeTab === 'settings' ? ' settings-button--active' : ''}`}
                type="button"
                onClick={() => onSelectTab('settings')}
              >
                <span className="nav-button-main">
                  <span>Settings</span>
                </span>
              </button>
            </li>
          </ul>
        </nav>

        <div className={`sidebar-meta${updateButton ? ' sidebar-meta--with-update' : ''}`}>
          <div>
            <p className="sidebar-meta-label">Last scan</p>
            <p className="sidebar-meta-copy">{inventorySnapshot ? lastScanLabel : 'Not scanned yet'}</p>
          </div>
          {updateButton ? (
            <button
              aria-label={updateButton.ariaLabel}
              className={`sidebar-update-button sidebar-update-button--${updateButton.tone}`}
              disabled={!updateButton.canInstall}
              title={updateButton.title}
              type="button"
              onClick={updateButton.canInstall ? onInstallUpdate : undefined}
            >
              {updateButton.label}
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function getUpdateButton(status: AutoUpdateStatus | undefined, isInstallingUpdate: boolean): {
  ariaLabel: string;
  canInstall: boolean;
  label: string;
  title: string;
  tone: 'downloading' | 'ready';
} | null {
  if (!status || status.phase === 'disabled' || status.phase === 'idle' || status.phase === 'checking') {
    return null;
  }

  if (status.phase === 'ready') {
    const versionLabel = status.version ? ` ${status.version}` : '';
    return {
      ariaLabel: `Restart to install Skill Index${versionLabel}`,
      canInstall: !isInstallingUpdate,
      label: isInstallingUpdate ? 'Restarting' : 'Update',
      title: `Restart to install Skill Index${versionLabel}`,
      tone: 'ready',
    };
  }

  if (status.phase === 'downloading') {
    return {
      ariaLabel: 'Skill Index update is downloading',
      canInstall: false,
      label: 'Updating',
      title: 'Downloading a Skill Index update',
      tone: 'downloading',
    };
  }

  return null;
}

function InventorySourceButton({
  disabled,
  isActive,
  label,
  mode,
  onKeyboardSelect,
  onSelect,
}: {
  disabled: boolean;
  isActive: boolean;
  label: string;
  mode: InventorySourceMode;
  onKeyboardSelect: (mode: InventorySourceMode) => void;
  onSelect: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextMode = getKeyboardTargetMode(event.key, mode);
    if (!nextMode) {
      return;
    }

    event.preventDefault();
    onKeyboardSelect(nextMode);
  };

  return (
    <button
      aria-checked={isActive}
      className={`sidebar-source-option${isActive ? ' sidebar-source-option--active' : ''}`}
      disabled={disabled}
      role="radio"
      tabIndex={isActive ? 0 : -1}
      type="button"
      onKeyDown={handleKeyDown}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function getKeyboardTargetMode(key: string, currentMode: InventorySourceMode): InventorySourceMode | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
    case 'End':
      return 'live';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'Home':
      return 'sandbox';
    case ' ':
    case 'Enter':
      return currentMode;
    default:
      return null;
  }
}
