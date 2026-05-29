import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@renderer/App';
import { APP_NAME, type SettingsState, type SkillInventorySnapshot, type SkillIndexDesktopApi } from '@shared/contracts';

import { representativeInventorySnapshot } from './representative-preview-data';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App search behavior', () => {
  beforeEach(() => {
    const inventorySnapshot = structuredClone(representativeInventorySnapshot);
    const desktopApi = createDesktopApi(inventorySnapshot);

    Object.defineProperty(window, 'skillIndex', {
      configurable: true,
      value: desktopApi,
      writable: true,
    });
    Object.defineProperty(window, 'skillIndexBootstrap', {
      configurable: true,
      value: { initialInventorySnapshot: inventorySnapshot },
      writable: true,
    });
  });

  it('shows the Command+F shortcut hint on every searchable workspace', async () => {
    render(<App />);

    await openTab('Skills');
    expect(screen.getByRole('searchbox', { name: /Search skills/i })).toBeInTheDocument();
    expect(screen.getByText('⌘F')).toBeInTheDocument();

    await openTab('MCPs');
    expect(screen.getByRole('searchbox', { name: /Search MCPs/i })).toBeInTheDocument();
    expect(screen.getByText('⌘F')).toBeInTheDocument();

    await openTab('Agents');
    expect(screen.getByRole('searchbox', { name: /Search agents/i })).toBeInTheDocument();
    expect(screen.getByText('⌘F')).toBeInTheDocument();

    await openTab('Audit Log');
    expect(screen.getByRole('searchbox', { name: /Search audit log/i })).toBeInTheDocument();
    expect(screen.getByText('⌘F')).toBeInTheDocument();
  });

  it('filters agents from the header search field and focuses that field on Command+F', async () => {
    render(<App />);

    await openTab('Agents');

    const searchbox = screen.getByRole('searchbox', { name: /Search agents/i });

    fireEvent.change(searchbox, { target: { value: 'windsurf' } });

    expect(screen.getByText('Windsurf')).toBeInTheDocument();
    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    expect(screen.queryByText('Factory')).not.toBeInTheDocument();

    screen.getByRole('button', { name: /^Agents\d*$/i }).focus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });

    expect(searchbox).toHaveFocus();
  });

  it('matches skills from the header search field by description', async () => {
    render(<App />);

    await openTab('Skills');

    const searchbox = screen.getByRole('searchbox', { name: /Search skills/i });

    fireEvent.change(searchbox, { target: { value: 'resolves cleanly' } });

    expect(screen.getByText('MiXeD-Case-Skill')).toBeInTheDocument();
    expect(screen.queryByText('healthy-skill')).not.toBeInTheDocument();
  });

  it('matches agents from the header search field by path', async () => {
    render(<App />);

    await openTab('Agents');

    const searchbox = screen.getByRole('searchbox', { name: /Search agents/i });

    fireEvent.change(searchbox, { target: { value: '.codeium/windsurf' } });

    expect(screen.getByText('Windsurf')).toBeInTheDocument();
    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    expect(screen.queryByText('Factory')).not.toBeInTheDocument();
  });

  it('exits the active page search when Escape is pressed', async () => {
    render(<App />);

    await openTab('MCPs');

    const searchbox = screen.getByRole('searchbox', { name: /Search MCPs/i });
    searchbox.focus();
    expect(searchbox).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(searchbox).not.toHaveFocus();
  });

  it('uses the shared Rescan action in the Agents header', async () => {
    render(<App />);

    await openTab('Agents');

    const rescanButton = screen.getByRole('button', { name: /^Rescan$/i });
    expect(rescanButton.querySelector('svg')).not.toBeNull();
  });

  it('uses the shared Rescan action in the Settings header', async () => {
    render(<App />);

    await openTab('Settings');

    const rescanButton = screen.getByRole('button', { name: /^Rescan$/i });
    expect(rescanButton.querySelector('svg')).not.toBeNull();
  });

  it('shows loading feedback and a success toast for manual rescan button clicks', async () => {
    const inventorySnapshot = structuredClone(representativeInventorySnapshot);
    const deferred = createDeferred<SkillInventorySnapshot>();
    const desktopApi = createDesktopApi(inventorySnapshot);
    desktopApi.rescanInventory = vi.fn().mockReturnValue(deferred.promise);

    Object.defineProperty(window, 'skillIndex', {
      configurable: true,
      value: desktopApi,
      writable: true,
    });
    Object.defineProperty(window, 'skillIndexBootstrap', {
      configurable: true,
      value: { initialInventorySnapshot: inventorySnapshot },
      writable: true,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^Rescan$/i }));

    const loadingButton = await screen.findByRole('button', { name: /^Rescanning…$/i });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute('aria-busy', 'true');

    deferred.resolve(inventorySnapshot);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Inventory refreshed');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Manual rescan completed successfully.');
  });

  it('does not show the manual rescan toast for settings-driven rescans', async () => {
    const inventorySnapshot = structuredClone(representativeInventorySnapshot);
    const settingsState: SettingsState = {
      customScanPaths: ['/tmp/skillindex/custom-scan'],
      onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    };
    const desktopApi = createDesktopApi(inventorySnapshot);
    const addCustomScanPathMock = vi.fn().mockResolvedValue(settingsState);
    const rescanInventoryMock = vi.fn().mockResolvedValue(inventorySnapshot);
    desktopApi.addCustomScanPath = addCustomScanPathMock;
    desktopApi.rescanInventory = rescanInventoryMock;

    Object.defineProperty(window, 'skillIndex', {
      configurable: true,
      value: desktopApi,
      writable: true,
    });
    Object.defineProperty(window, 'skillIndexBootstrap', {
      configurable: true,
      value: { initialInventorySnapshot: inventorySnapshot },
      writable: true,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^Settings$/i }));
    await screen.findByRole('heading', { level: 2, name: /^Settings$/i });

    fireEvent.change(screen.getByLabelText(/Custom scan path/i), { target: { value: '/tmp/skillindex/custom-scan' } });
    fireEvent.click(screen.getByRole('button', { name: /Add path/i }));

    await waitFor(() => {
      expect(addCustomScanPathMock.mock.calls).toContainEqual(['/tmp/skillindex/custom-scan']);
      expect(rescanInventoryMock.mock.calls).toHaveLength(1);
    });

    expect(await screen.findByRole('status')).toHaveTextContent('Settings updated');
    expect(screen.queryByText('Manual rescan completed successfully.')).not.toBeInTheDocument();
  });
});

async function openTab(label: 'Skills' | 'MCPs' | 'Agents' | 'Audit Log' | 'Settings') {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}\\d*$`, 'i') }));
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^${label}$`, 'i') })).toBeInTheDocument();
  });
}

function createDesktopApi(inventorySnapshot: SkillInventorySnapshot): SkillIndexDesktopApi {
  const settingsState: SettingsState = {
    customScanPaths: [],
    onboardingCompletedAt: '2026-05-19T00:00:00.000Z',
    preferredCanonicalSourcePath: null,
    showDevSidebarInventorySourceSwitcher: true,
  };

  return {
    getShellState: vi.fn().mockResolvedValue({
      appName: APP_NAME,
      username: 'arjitjaiswal',
      dataDir: '~/.skillindex',
      cacheFile: '~/.skillindex/cache.json',
      configFile: '~/.skillindex/config.json',
      liveCanonicalUserSkillsDir: '~/.agents/skills',
      startupObservationDelayMs: 0,
      startupObservationHold: false,
      preloadStatus: 'ready',
    }),
    readUpdateStatus: vi.fn().mockResolvedValue({ phase: 'disabled' }),
    checkForUpdates: vi.fn().mockResolvedValue({ phase: 'disabled' }),
    installUpdate: vi.fn().mockResolvedValue({ phase: 'disabled' }),
    openPathInEditor: vi.fn().mockResolvedValue(undefined),
    revealPathInFinder: vi.fn().mockResolvedValue(undefined),
    chooseDirectory: vi.fn().mockResolvedValue(null),
    readSettings: vi.fn().mockResolvedValue(settingsState),
    readCachedInventory: vi.fn().mockResolvedValue(inventorySnapshot),
    scanInventory: vi.fn().mockResolvedValue(inventorySnapshot),
    rescanInventory: vi.fn().mockResolvedValue(inventorySnapshot),
    testMcpConnectivity: vi.fn().mockResolvedValue(inventorySnapshot),
    cancelMcpConnectivityTest: vi.fn().mockResolvedValue(undefined),
    addSkill: vi.fn().mockResolvedValue(inventorySnapshot),
    addMcpServer: vi.fn().mockResolvedValue(inventorySnapshot),
    resolveIssue: vi.fn().mockResolvedValue(inventorySnapshot),
    dismissDrift: vi.fn().mockResolvedValue(inventorySnapshot),
    applyCapabilityAction: vi.fn().mockResolvedValue(inventorySnapshot),
    readAuditLog: vi.fn().mockResolvedValue([]),
    undoAuditOperation: vi.fn().mockResolvedValue({
      auditLog: [],
      inventorySnapshot,
      settingsState,
    }),
    releaseStartupObservation: vi.fn().mockResolvedValue(undefined),
    onUpdateStatusUpdated: vi.fn().mockReturnValue(() => undefined),
    onInventoryUpdated: vi.fn().mockReturnValue(() => undefined),
    onAuditUpdated: vi.fn().mockReturnValue(() => undefined),
    addCustomScanPath: vi.fn().mockResolvedValue(settingsState),
    removeCustomScanPath: vi.fn().mockResolvedValue(settingsState),
    setPreferredCanonicalSourcePath: vi.fn().mockResolvedValue(settingsState),
    clearPreferredCanonicalSourcePath: vi.fn().mockResolvedValue(settingsState),
    setDevSidebarInventorySourceSwitcherVisible: vi.fn().mockResolvedValue(settingsState),
    completeOnboarding: vi.fn().mockResolvedValue(settingsState),
    ping: vi.fn().mockResolvedValue('pong'),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
