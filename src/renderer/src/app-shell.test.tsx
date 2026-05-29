import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import App from '@renderer/App';
import {
  type AgentRecord,
  type AppShellState,
  type AuditOperation,
  type AutoUpdateStatus,
  type SettingsState,
  type SkillInventorySnapshot,
  type SkillRecord,
  type SkillIssueReason,
  type SkillIndexDesktopApi,
} from '@shared/contracts';
import {
  DETAIL_DIFF_TITLE,
  MCP_DETAIL_DIFF_TITLE,
  buildMcpInspectorModel,
  buildSkillInspectorModel,
} from './lib/detail-inspector-model';
import { getHomeSummary } from './inventory-view-model';
import { representativeInventorySnapshot } from './representative-preview-data';
import {
  AGENT_CATALOG,
  deriveAgentDefaultHomeDir,
  resolveAgentHomeRelativePath,
} from '@shared/agent-catalog';

const DEFAULT_DATA_DIR = '/Users/arjitjaiswal/.skillindex';
const DEFAULT_SANDBOX_ROOT = `${DEFAULT_DATA_DIR}/sandbox`;
const INVALID_DEFINITION_HELP_TEXT = 'Click a file name above to open it, then fix the definition.';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('App shell inventory views', () => {
  let api: SkillIndexDesktopApi;
  let getShellStateMock: Mock<SkillIndexDesktopApi['getShellState']>;
  let readSettingsMock: Mock<SkillIndexDesktopApi['readSettings']>;
  let readCachedInventoryMock: Mock<SkillIndexDesktopApi['readCachedInventory']>;
  let scanInventoryMock: Mock<SkillIndexDesktopApi['scanInventory']>;
  let rescanInventoryMock: Mock<SkillIndexDesktopApi['rescanInventory']>;
  let testMcpConnectivityMock: Mock<SkillIndexDesktopApi['testMcpConnectivity']>;
  let cancelMcpConnectivityTestMock: Mock<SkillIndexDesktopApi['cancelMcpConnectivityTest']>;
  let addSkillMock: Mock<SkillIndexDesktopApi['addSkill']>;
  let addMcpServerMock: Mock<SkillIndexDesktopApi['addMcpServer']>;
  let makeCanonicalMock: Mock<SkillIndexDesktopApi['resolveIssue']>;
  let dismissDriftMock: Mock<SkillIndexDesktopApi['dismissDrift']>;
  let applyCapabilityActionMock: Mock<SkillIndexDesktopApi['applyCapabilityAction']>;
  let readAuditLogMock: Mock<SkillIndexDesktopApi['readAuditLog']>;
  let undoAuditOperationMock: Mock<SkillIndexDesktopApi['undoAuditOperation']>;
  let seedRepresentativeFixturesMock: Mock<NonNullable<typeof window.skillIndexDev>['seedRepresentativeFixtures']>;
  let setInventoryModeMock: Mock<NonNullable<typeof window.skillIndexDev>['setInventoryMode']>;
  let chooseDirectoryMock: Mock<SkillIndexDesktopApi['chooseDirectory']>;
  let addCustomScanPathMock: Mock<SkillIndexDesktopApi['addCustomScanPath']>;
  let removeCustomScanPathMock: Mock<SkillIndexDesktopApi['removeCustomScanPath']>;
  let setPreferredCanonicalSourcePathMock: Mock<SkillIndexDesktopApi['setPreferredCanonicalSourcePath']>;
  let clearPreferredCanonicalSourcePathMock: Mock<SkillIndexDesktopApi['clearPreferredCanonicalSourcePath']>;
  let setDevSidebarInventorySourceSwitcherVisibleMock: Mock<SkillIndexDesktopApi['setDevSidebarInventorySourceSwitcherVisible']>;
  let completeOnboardingMock: Mock<SkillIndexDesktopApi['completeOnboarding']>;
  let readUpdateStatusMock: Mock<SkillIndexDesktopApi['readUpdateStatus']>;
  let installUpdateMock: Mock<SkillIndexDesktopApi['installUpdate']>;
  let onInventoryUpdatedMock: Mock<SkillIndexDesktopApi['onInventoryUpdated']>;
  let onUpdateStatusUpdatedMock: Mock<SkillIndexDesktopApi['onUpdateStatusUpdated']>;
  let onAuditUpdatedMock: Mock<SkillIndexDesktopApi['onAuditUpdated']>;
  let inventoryUpdatedListener: ((snapshot: SkillInventorySnapshot) => void) | null;
  let updateStatusUpdatedListener: ((status: AutoUpdateStatus) => void) | null;

  beforeEach(() => {
    getShellStateMock = vi.fn().mockResolvedValue(createShellState());
    readSettingsMock = vi.fn().mockResolvedValue(createSettingsState());
    readCachedInventoryMock = vi.fn().mockResolvedValue(createInventorySnapshot());
    scanInventoryMock = vi.fn().mockResolvedValue(createInventorySnapshot());
    rescanInventoryMock = vi.fn().mockResolvedValue(createReconciledInventorySnapshot());
    testMcpConnectivityMock = vi.fn().mockResolvedValue(createReconciledInventorySnapshot());
    cancelMcpConnectivityTestMock = vi.fn().mockResolvedValue(undefined);
    addSkillMock = vi.fn().mockResolvedValue(createInventorySnapshot());
    addMcpServerMock = vi.fn().mockResolvedValue(createInventorySnapshot());
    makeCanonicalMock = vi.fn().mockResolvedValue(createCanonicalizedDivergedInventorySnapshot());
    dismissDriftMock = vi.fn().mockResolvedValue(createDismissedIdenticalDriftInventorySnapshot());
    applyCapabilityActionMock = vi.fn().mockResolvedValue(createInventorySnapshot());
    readAuditLogMock = vi.fn().mockResolvedValue([]);
    undoAuditOperationMock = vi.fn().mockResolvedValue({
      auditLog: [],
      inventorySnapshot: createInventorySnapshot(),
      settingsState: createSettingsState(),
    });
    seedRepresentativeFixturesMock = vi.fn().mockResolvedValue({
      fixtureSet: 'representative-agent-scan-foundation',
      sandboxRoot: DEFAULT_SANDBOX_ROOT,
      ignoredPaths: [],
      skills: [],
    });
    setInventoryModeMock = vi.fn().mockImplementation((mode) => Promise.resolve(mode));
    chooseDirectoryMock = vi.fn().mockResolvedValue(null);
    addCustomScanPathMock = vi.fn().mockResolvedValue(createSettingsState(['/tmp/skillindex/custom-scan']));
    removeCustomScanPathMock = vi.fn().mockResolvedValue(createSettingsState());
    setPreferredCanonicalSourcePathMock = vi.fn().mockResolvedValue(createSettingsState());
    clearPreferredCanonicalSourcePathMock = vi.fn().mockResolvedValue(createSettingsState());
    setDevSidebarInventorySourceSwitcherVisibleMock = vi.fn().mockResolvedValue(createSettingsState());
    completeOnboardingMock = vi.fn().mockResolvedValue(createSettingsState());
    readUpdateStatusMock = vi.fn().mockResolvedValue({ phase: 'disabled' });
    installUpdateMock = vi.fn().mockResolvedValue({ phase: 'ready', version: '0.2.0' });
    inventoryUpdatedListener = null;
    updateStatusUpdatedListener = null;
    onInventoryUpdatedMock = vi.fn((listener: (snapshot: SkillInventorySnapshot) => void) => {
      inventoryUpdatedListener = listener;
      return () => undefined;
    });
    onUpdateStatusUpdatedMock = vi.fn((listener: (status: AutoUpdateStatus) => void) => {
      updateStatusUpdatedListener = listener;
      return () => undefined;
    });
    onAuditUpdatedMock = vi.fn(() => {
      return () => undefined;
    });
    api = {
      getShellState: getShellStateMock,
      readUpdateStatus: readUpdateStatusMock,
      checkForUpdates: vi.fn().mockResolvedValue({ phase: 'disabled' }),
      installUpdate: installUpdateMock,
      openPathInEditor: vi.fn().mockResolvedValue(undefined),
      revealPathInFinder: vi.fn().mockResolvedValue(undefined),
      chooseDirectory: chooseDirectoryMock,
      readSettings: readSettingsMock,
      readCachedInventory: readCachedInventoryMock,
      scanInventory: scanInventoryMock,
      rescanInventory: rescanInventoryMock,
      testMcpConnectivity: testMcpConnectivityMock,
      cancelMcpConnectivityTest: cancelMcpConnectivityTestMock,
      addSkill: addSkillMock,
      addMcpServer: addMcpServerMock,
      resolveIssue: makeCanonicalMock,
      dismissDrift: dismissDriftMock,
      applyCapabilityAction: applyCapabilityActionMock,
      readAuditLog: readAuditLogMock,
      undoAuditOperation: undoAuditOperationMock,
      releaseStartupObservation: vi.fn().mockResolvedValue(undefined),
      onUpdateStatusUpdated: onUpdateStatusUpdatedMock,
      onInventoryUpdated: onInventoryUpdatedMock,
      onAuditUpdated: onAuditUpdatedMock,
      addCustomScanPath: addCustomScanPathMock,
      removeCustomScanPath: removeCustomScanPathMock,
      setPreferredCanonicalSourcePath: setPreferredCanonicalSourcePathMock,
      clearPreferredCanonicalSourcePath: clearPreferredCanonicalSourcePathMock,
      setDevSidebarInventorySourceSwitcherVisible: setDevSidebarInventorySourceSwitcherVisibleMock,
      completeOnboarding: completeOnboardingMock,
      ping: vi.fn().mockResolvedValue('pong'),
    };

    Object.defineProperty(window, 'skillIndex', {
      value: api,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'skillIndexDev', {
      value: {
        seedRepresentativeFixtures: seedRepresentativeFixturesMock,
        setInventoryMode: setInventoryModeMock,
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'skillIndexBootstrap', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  async function openSkills() {
    fireEvent.click(within(await getPrimaryNavAsync()).getByRole('button', { name: /^Skills/i }));
    await screen.findByRole('searchbox', { name: /Search skills/i });
    await waitFor(() => {
      expect(screen.queryByText(/Scanning your skill inventory/i)).not.toBeInTheDocument();
    });
  }

  async function clearSkillsSelection() {
    fireEvent.click(within(await getPrimaryNavAsync()).getByRole('button', { name: /^Skills/i }));
    await screen.findByRole('searchbox', { name: /Search skills/i });
  }

  async function getPrimaryNavAsync() {
    return screen.findByRole('navigation', { name: /Primary/i });
  }

  function getPrimaryNav() {
    return screen.getByRole('navigation', { name: /Primary/i });
  }

  function getSkillsTable() {
    return screen.getByRole('region', { name: /^Skills list$/i });
  }

  function getSkillDataRows() {
    return within(getSkillsTable()).getAllByRole('button');
  }

  function getSkillRow(name: string) {
    const pattern = new RegExp(name, 'i');
    return within(getSkillsTable()).getByRole('button', { name: pattern });
  }

  async function openSettings() {
    fireEvent.click(await screen.findByRole('button', { name: /^Settings/i }));
    await screen.findByRole('heading', { name: /^Settings$/i, level: 2 });
  }

  async function openMcps() {
    fireEvent.click(within(await getPrimaryNavAsync()).getByRole('button', { name: /^MCPs/i }));
    await screen.findByRole('heading', { name: /^MCPs$/i, level: 2 });
    await waitFor(() => {
      expect(screen.queryByText(/Scanning your MCP inventory/i)).not.toBeInTheDocument();
    });
  }

  async function openSubagents() {
    fireEvent.click(within(await getPrimaryNavAsync()).getByRole('button', { name: /^Subagents/i }));
    await screen.findByRole('heading', { name: /^Subagents$/i, level: 2 });
    await waitFor(() => {
      expect(screen.queryByText(/Scanning your subagent inventory/i)).not.toBeInTheDocument();
    });
  }

  function getMcpTable() {
    return screen.getByRole('region', { name: /^MCP list$/i });
  }

  function getMcpDataRows() {
    return within(getMcpTable()).getAllByRole('button');
  }

  function getMcpRow(name: string) {
    const pattern = new RegExp(name, 'i');
    return within(getMcpTable()).getByRole('button', { name: pattern });
  }

  function getSubagentTable() {
    return screen.getByRole('region', { name: /^Subagent list$/i });
  }

  function getSubagentRow(name: string) {
    const pattern = new RegExp(name, 'i');
    return within(getSubagentTable()).getByRole('button', { name: pattern });
  }

  function getHomeAttentionSection() {
    return screen.getByRole('region', { name: /^Needs attention$/i });
  }

  async function openAgents() {
    fireEvent.click(within(await getPrimaryNavAsync()).getByRole('button', { name: /^Agents/i }));
    await screen.findByRole('heading', { name: /^Agents$/i, level: 2 });
    await waitFor(() => {
      expect(getAgentDataRows().length).toBeGreaterThan(0);
    });
  }

  function getAgentsList() {
    return screen.getByRole('region', { name: /^Agents list$/i });
  }

  function getAgentDataRows() {
    return Array.from(getAgentsList().querySelectorAll('.agent-status-row'));
  }

  function getAgentRow(name: string) {
    const label = within(getAgentsList()).getByText(name);
    const row = label.closest('.agent-status-row');
    expect(row).not.toBeNull();
    return row as HTMLElement;
  }

  it('launches into Home with six primary tabs and keeps Audit Log above Settings', async () => {
    readAuditLogMock.mockResolvedValue(createAuditOperations());
    render(<App />);

    const primaryNav = await getPrimaryNavAsync();
    await waitFor(() => {
      expect(within(primaryNav).getByRole('button', { name: /^Home$/i })).toHaveAttribute('aria-pressed', 'true');
    });

    const installedAgentCount = createInventorySnapshot().agentCounts?.installedAgents ?? 0;

    expect(within(primaryNav).getAllByRole('button')).toHaveLength(6);
    expect(within(primaryNav).getAllByRole('button').map((button) => button.textContent?.replace(/\s+/g, ''))).toEqual([
      'Home',
      'Skills38',
      'MCPs16',
      'Subagents0',
      'Plugins0',
      `Agents${installedAgentCount}`,
    ]);
    expect(within(primaryNav).getByRole('button', { name: /^Home$/i })).toHaveTextContent(/^Home$/);
    expect(within(primaryNav).getByRole('button', { name: /^Skills/i })).toHaveTextContent(/^Skills38$/);
    expect(within(primaryNav).getByRole('button', { name: /^MCPs/i })).toHaveTextContent(/^MCPs16$/);
    expect(within(primaryNav).getByRole('button', { name: /^Subagents/i })).toHaveTextContent(/^Subagents0$/);
    expect(within(primaryNav).getByRole('button', { name: /^Agents/i })).toHaveTextContent(
      new RegExp(`^Agents${installedAgentCount}$`),
    );
    expect(within(primaryNav).getByRole('button', { name: /^Plugins/i })).toHaveTextContent(/^Plugins0$/);
    expect(within(primaryNav).queryByRole('button', { name: /^Audit Log$/i })).not.toBeInTheDocument();
    expect(within(primaryNav).queryByRole('button', { name: /^All Skills/i })).not.toBeInTheDocument();
    expect(within(primaryNav).queryByRole('button', { name: /^Drift/i })).not.toBeInTheDocument();

    const auditLogButton = screen.getByRole('button', { name: /^Audit Log$/i });
    const settingsButton = screen.getByRole('button', { name: /^Settings/i });
    expect(primaryNav.compareDocumentPosition(auditLogButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(auditLogButton.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(primaryNav.compareDocumentPosition(settingsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Home$/i, level: 2 })).toBeInTheDocument();
  });

  it('shows first-run onboarding before scanning and records a preferred source first', async () => {
    const preferredSourcePath = '/Users/arjitjaiswal/repos/published-skills';
    readSettingsMock.mockResolvedValueOnce(createSettingsState([], null, null));
    chooseDirectoryMock.mockResolvedValueOnce(preferredSourcePath);
    setPreferredCanonicalSourcePathMock.mockResolvedValueOnce(createSettingsState(
      [preferredSourcePath],
      preferredSourcePath,
      null,
    ));
    completeOnboardingMock.mockResolvedValueOnce(createSettingsState(
      [preferredSourcePath],
      preferredSourcePath,
      '2026-05-19T06:30:00.000Z',
    ));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /^How it fits together$/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Organize and standardize your knowledge across agents/i)).toBeInTheDocument();
    expect(screen.getByText('~/.agents/skills')).toBeInTheDocument();

    await waitFor(() => {
      expect(readCachedInventoryMock).not.toHaveBeenCalled();
      expect(scanInventoryMock).not.toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Continue/i }));
    expect(await screen.findByRole('heading', { name: /^Where your skills live$/i, level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Browse/i }));
    await waitFor(() => {
      expect(chooseDirectoryMock).toHaveBeenCalledWith({
        title: 'Choose a preferred skills source',
      });
    });
    expect(await screen.findByText(preferredSourcePath)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Scan my machine$/i }));

    await waitFor(() => {
      expect(setPreferredCanonicalSourcePathMock).toHaveBeenCalledWith(preferredSourcePath);
    });
    await waitFor(() => {
      expect(rescanInventoryMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(completeOnboardingMock).toHaveBeenCalledWith({});
    });
    expect(setPreferredCanonicalSourcePathMock.mock.invocationCallOrder[0]).toBeLessThan(rescanInventoryMock.mock.invocationCallOrder[0]);
    expect(rescanInventoryMock.mock.invocationCallOrder[0]).toBeLessThan(completeOnboardingMock.mock.invocationCallOrder[0]);
    expect(await screen.findByRole('navigation', { name: /Primary/i })).toBeInTheDocument();
  });

  it('keeps first-run onboarding incomplete when the initial scan fails', async () => {
    readSettingsMock.mockResolvedValueOnce(createSettingsState([], null, null));
    rescanInventoryMock.mockRejectedValueOnce(new Error('Scan failed during onboarding.'));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /^How it fits together$/i, level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Continue/i }));
    expect(await screen.findByRole('heading', { name: /^Where your skills live$/i, level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Scan my machine$/i }));

    await waitFor(() => {
      expect(rescanInventoryMock).toHaveBeenCalledTimes(1);
    });
    expect(completeOnboardingMock).not.toHaveBeenCalled();
    const toast = await screen.findByRole('status');
    expect(within(toast).getByText('Onboarding failed')).toBeInTheDocument();
    expect(within(toast).getByText('Scan failed during onboarding.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Primary/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Where your skills live$/i, level: 1 })).toBeInTheDocument();
  });

  it('shows, expands, and copies the failed first-run scan trace from the audit log', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });
    readSettingsMock.mockResolvedValueOnce(createSettingsState([], null, null));
    rescanInventoryMock.mockRejectedValueOnce(new Error('Failed to parse Skill Index config.'));
    readAuditLogMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(createAuditOperations({
        kind: 'inventory-rescan',
        title: 'Inventory rescan failed',
        summary: 'Manual inventory rescan failed before the latest snapshot could be saved.',
        status: 'failed',
        undoState: 'not-undoable',
        actionCount: 0,
        actions: [],
        failure: {
          message: 'Failed to parse Skill Index config.',
          trace: 'Error: Failed to parse Skill Index config.\\n    at scanInventory (src/main/scan-inventory.ts:1:1)',
        },
      }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /^How it fits together$/i, level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Continue/i }));
    expect(await screen.findByRole('heading', { name: /^Where your skills live$/i, level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Scan my machine$/i }));

    await waitFor(() => {
      expect(readAuditLogMock).toHaveBeenCalledWith({ limit: 1 });
    });
    expect(screen.queryByText(/scanInventory/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /^Show failure trace$/i }));

    const inlineTrace = await screen.findByText(/scanInventory/);
    expect(inlineTrace.textContent).toBe(
      'Error: Failed to parse Skill Index config.\n    at scanInventory (src/main/scan-inventory.ts:1:1)',
    );
    expect(inlineTrace.textContent).not.toContain('\\n');
    expect(screen.getByRole('button', { name: /^Hide failure trace$/i })).toBeInTheDocument();

    const copyTraceButton = await screen.findByRole('button', { name: /^Copy failure trace$/i });
    fireEvent.click(copyTraceButton);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining(
        'Error: Failed to parse Skill Index config.\n    at scanInventory',
      ));
    });
    expect(screen.getByRole('button', { name: /^Failure trace copied$/i })).toBeInTheDocument();
  });

  it('clears a persisted onboarding preferred source before retrying without one', async () => {
    const preferredSourcePath = '/Users/arjitjaiswal/repos/problem-skills';
    readSettingsMock.mockResolvedValueOnce(createSettingsState([], null, null));
    chooseDirectoryMock.mockResolvedValueOnce(preferredSourcePath);
    setPreferredCanonicalSourcePathMock.mockResolvedValueOnce(createSettingsState(
      [preferredSourcePath],
      preferredSourcePath,
      null,
    ));
    clearPreferredCanonicalSourcePathMock.mockResolvedValueOnce(createSettingsState([], null, null));
    rescanInventoryMock
      .mockRejectedValueOnce(new Error('Scan failed during onboarding.'))
      .mockResolvedValueOnce(createInventorySnapshot());
    completeOnboardingMock.mockResolvedValueOnce(createSettingsState(
      [],
      null,
      '2026-05-19T06:30:00.000Z',
    ));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /^How it fits together$/i, level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Continue/i }));
    expect(await screen.findByRole('heading', { name: /^Where your skills live$/i, level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Browse/i }));
    expect(await screen.findByText(preferredSourcePath)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Scan my machine$/i }));

    await waitFor(() => {
      expect(rescanInventoryMock).toHaveBeenCalledTimes(1);
    });
    expect(completeOnboardingMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Remove preferred source$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Scan my machine$/i }));

    await waitFor(() => {
      expect(clearPreferredCanonicalSourcePathMock).toHaveBeenCalledTimes(1);
      expect(rescanInventoryMock).toHaveBeenCalledTimes(2);
      expect(completeOnboardingMock).toHaveBeenCalledWith({});
    });
    expect(setPreferredCanonicalSourcePathMock.mock.invocationCallOrder[0]).toBeLessThan(rescanInventoryMock.mock.invocationCallOrder[0]);
    expect(clearPreferredCanonicalSourcePathMock.mock.invocationCallOrder[0]).toBeLessThan(rescanInventoryMock.mock.invocationCallOrder[1]);
  });

  it('holds startup UI instead of flashing the app shell while first-run settings load', async () => {
    let resolveSettings: (settingsState: SettingsState) => void = () => undefined;
    readSettingsMock.mockReturnValueOnce(new Promise<SettingsState>((resolve) => {
      resolveSettings = resolve;
    }));

    render(<App />);

    expect(screen.getByRole('status', { name: /Loading Skill Index/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Primary/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^How it fits together$/i, level: 1 })).not.toBeInTheDocument();
    expect(readCachedInventoryMock).not.toHaveBeenCalled();
    expect(scanInventoryMock).not.toHaveBeenCalled();

    act(() => {
      resolveSettings(createSettingsState([], null, null));
    });

    expect(await screen.findByRole('heading', { name: /^How it fits together$/i, level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Primary/i })).not.toBeInTheDocument();
    expect(readCachedInventoryMock).not.toHaveBeenCalled();
    expect(scanInventoryMock).not.toHaveBeenCalled();
  });

  it('does not show onboarding before or after completed settings load on later launches', async () => {
    let resolveSettings: (settingsState: SettingsState) => void = () => undefined;
    readSettingsMock.mockReturnValueOnce(new Promise<SettingsState>((resolve) => {
      resolveSettings = resolve;
    }));

    render(<App />);

    expect(screen.getByRole('status', { name: /Loading Skill Index/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Primary/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^How it fits together$/i, level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Where your skills live$/i, level: 1 })).not.toBeInTheDocument();
    expect(readCachedInventoryMock).not.toHaveBeenCalled();
    expect(scanInventoryMock).not.toHaveBeenCalled();

    act(() => {
      resolveSettings(createSettingsState([], null, '2026-05-19T00:00:00.000Z'));
    });

    expect(await screen.findByRole('navigation', { name: /Primary/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^How it fits together$/i, level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Where your skills live$/i, level: 1 })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(readCachedInventoryMock).toHaveBeenCalledTimes(1);
      expect(scanInventoryMock).toHaveBeenCalledTimes(1);
    });
    expect(completeOnboardingMock).not.toHaveBeenCalled();
  });

  it('shows a download progress dialog while an update downloads', async () => {
    readUpdateStatusMock.mockResolvedValue({
      downloadProgress: {
        percent: 23.5714,
        totalBytes: 28_000_000,
        transferredBytes: 6_600_000,
      },
      phase: 'downloading',
      version: '0.2.0',
      lastCheckedAt: '2026-05-17T00:00:00.000Z',
    });
    render(<App />);

    const updateDialog = await screen.findByRole('dialog', { name: /Updating Skill Index/i });
    const progressbar = within(updateDialog).getByRole('progressbar', { name: /Update download progress/i });

    expect(within(updateDialog).getByRole('heading', { name: /Downloading update/i })).toBeInTheDocument();
    expect(within(updateDialog).getByText('6.6 MB of 28.0 MB')).toBeInTheDocument();
    expect(progressbar).toHaveAttribute('aria-valuenow', '24');
  });

  it('relaunches automatically once a downloaded update is ready', async () => {
    readUpdateStatusMock.mockResolvedValue({
      downloadProgress: {
        percent: 100,
        totalBytes: 28_000_000,
        transferredBytes: 28_000_000,
      },
      phase: 'downloading',
      version: '0.2.0',
      lastCheckedAt: '2026-05-17T00:00:00.000Z',
    });
    render(<App />);

    await screen.findByRole('dialog', { name: /Updating Skill Index/i });
    await waitFor(() => {
      expect(onUpdateStatusUpdatedMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      updateStatusUpdatedListener?.({
        phase: 'ready',
        version: '0.2.0',
        lastCheckedAt: '2026-05-17T00:00:01.000Z',
      });
    });

    await waitFor(() => {
      expect(installUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole('dialog', { name: /Updating Skill Index/i })).toHaveTextContent(
      /Relaunching Skill Index/i,
    );
  });

  it('relaunches automatically when an update is already ready', async () => {
    readUpdateStatusMock.mockResolvedValue({
      phase: 'ready',
      version: '0.2.0',
      lastCheckedAt: '2026-05-17T00:00:00.000Z',
    });
    render(<App />);

    await waitFor(() => {
      expect(installUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole('dialog', { name: /Updating Skill Index/i })).toHaveTextContent(
      /Relaunching Skill Index/i,
    );
  });

  it('hides the sidebar update affordance when updates are disabled', async () => {
    readUpdateStatusMock.mockResolvedValue({ phase: 'disabled' });
    render(<App />);

    await screen.findByRole('navigation', { name: /Primary/i });

    expect(screen.queryByRole('button', { name: /Restart to install Skill Index/i })).not.toBeInTheDocument();
  });

  it('ticks the sidebar last scan age without waiting for another inventory update', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T00:00:09.000Z'));
    readCachedInventoryMock.mockReturnValue(new Promise(() => undefined));
    scanInventoryMock.mockReturnValue(new Promise(() => undefined));
    Object.defineProperty(window, 'skillIndexBootstrap', {
      value: { initialInventorySnapshot: createInventorySnapshot() },
      configurable: true,
      writable: true,
    });

    render(<App />);

    expect(screen.getByRole('status', { name: /Loading Skill Index/i })).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/^9s ago$/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText(/^11s ago$/i)).toBeInTheDocument();
  });

  it('opens the Audit tab and renders grouped operation actions', async () => {
    readAuditLogMock.mockResolvedValue(createAuditOperationsWithActionCount(2));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^Audit Log$/i }));

    expect(await screen.findByRole('heading', { name: /^Audit Log$/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rescan$/i })).toBeInTheDocument();
    expect(screen.queryByText(/events from .* operations/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Audit operation detail$/i })).not.toBeInTheDocument();

    const auditTable = screen.getByRole('table', { name: /^Audit events$/i });
    expect(within(auditTable).getByRole('columnheader', { name: /^Change$/i })).toBeInTheDocument();
    expect(within(auditTable).queryByRole('columnheader', { name: /^Status$/i })).not.toBeInTheDocument();
    expect(within(auditTable).getAllByRole('button', { name: /^Expand audit row/i })).toHaveLength(2);
    expect(within(auditTable).getByText(`${DEFAULT_SANDBOX_ROOT}/.factory/skills/missing-symlink-skill-1`)).toBeInTheDocument();
    expect(within(auditTable).getAllByText('Skill: missing-symlink-skill')).toHaveLength(2);
    expect(within(auditTable).queryByText('Resolved Missing Symlinks for missing-symlink-skill')).not.toBeInTheDocument();

    fireEvent.click(within(auditTable).getAllByRole('button', { name: /^Expand audit row/i })[0]);

    expect(await within(auditTable).findByText('Before')).toBeInTheDocument();
    expect(within(auditTable).getByText('After')).toBeInTheDocument();
    expect(within(auditTable).getByText('Parent operation')).toBeInTheDocument();
    expect(within(auditTable).getAllByText('Resolved Missing Symlinks for missing-symlink-skill').length).toBeGreaterThan(0);
    const undoButton = within(auditTable).getByRole('button', { name: /^Undo operation$/i });
    expect(undoButton).toBeEnabled();

    fireEvent.click(undoButton);

    await waitFor(() => {
      expect(undoAuditOperationMock).toHaveBeenCalledWith('audit-operation-1');
    });
  });

  it('shows and copies failure traces from failed audit operations', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });
    readAuditLogMock.mockResolvedValue(createAuditOperations({
      status: 'failed',
      undoState: 'not-undoable',
      actionCount: 0,
      actions: [],
      failure: {
        message: 'MCP "missing-from-agents-mcp" no longer has Missing From Agents.',
        trace: [
          'Error: MCP "missing-from-agents-mcp" no longer has Missing From Agents.',
          '    at resolveMcpIssueIfCurrent (src/main/issue-resolution.ts:1:1)',
        ].join('\n'),
      },
    }));

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^Audit Log$/i }));

    const auditTable = await screen.findByRole('table', { name: /^Audit events$/i });
    fireEvent.click(within(auditTable).getByRole('button', { name: /^Expand audit row/i }));

    expect(await within(auditTable).findByText('Failure')).toBeInTheDocument();
    expect(within(auditTable).getByText('MCP "missing-from-agents-mcp" no longer has Missing From Agents.')).toBeInTheDocument();
    const failureDetail = within(auditTable).getByText('Failure').closest('.audit-detail-item');
    expect(failureDetail).not.toBeNull();
    expect(within(failureDetail as HTMLElement).getByRole('button', { name: /^Copy failure trace$/i })).toBeInTheDocument();
    expect(document.querySelector('.audit-undo-panel .audit-copy-trace-button')).toBeNull();

    fireEvent.click(within(auditTable).getByRole('button', { name: /^Copy failure trace$/i }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('resolveMcpIssueIfCurrent'));
    });
    expect(within(failureDetail as HTMLElement).getByRole('button', { name: /^Failure trace copied$/i })).toBeInTheDocument();
  });

  it('paginates compact Audit rows for large audit trails', async () => {
    readAuditLogMock.mockResolvedValue(createAuditOperationsWithActionCount(55));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^Audit Log$/i }));

    const auditTable = await screen.findByRole('table', { name: /^Audit events$/i });
    expect(screen.getByText('1-50 of 55')).toBeInTheDocument();
    expect(within(auditTable).getAllByRole('button', { name: /^Expand audit row/i })).toHaveLength(50);
    expect(within(auditTable).getByText(`${DEFAULT_SANDBOX_ROOT}/.factory/skills/missing-symlink-skill-50`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Next page$/i }));

    expect(screen.getByText('51-55 of 55')).toBeInTheDocument();
    expect(within(auditTable).getAllByRole('button', { name: /^Expand audit row/i })).toHaveLength(5);
    expect(within(auditTable).getByText(`${DEFAULT_SANDBOX_ROOT}/.factory/skills/missing-symlink-skill-55`)).toBeInTheDocument();
  });

  it('shows distinct Audit empty copy when search filters out existing events', async () => {
    readAuditLogMock.mockResolvedValue(createAuditOperations());
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^Audit Log$/i }));
    fireEvent.change(screen.getByRole('searchbox', { name: /^Search audit log$/i }), {
      target: { value: 'no matching audit event' },
    });

    expect(await screen.findByText('No matching audit entries')).toBeInTheDocument();
    expect(screen.getByText('Try a different audit search.')).toBeInTheDocument();
    expect(screen.queryByText('App-made changes will appear here.')).not.toBeInTheDocument();
  });

  it('shows only the approved Home inventory metrics', async () => {
    render(<App />);

    await screen.findByLabelText(/Home inventory metrics/i);
    expect(document.querySelectorAll('.metric-card-icon')).toHaveLength(0);
    expect(document.querySelectorAll('.home-inventory-cell')).toHaveLength(3);
    expect(getHomeStatValue('Skills', 'on disk')).toBe('8');
    expect(getHomeStatValue('Skills', 'need attention')).toBe('3');
    expect(getHomeStatValue('Subagents', 'on disk')).toBe('0');
    expect(getHomeStatValue('Subagents', 'need attention')).toBe('0');
    expect(getHomeStatValue('MCPs', 'servers')).toBe('6');
    expect(getHomeStatValue('MCPs', 'need attention')).toBe('1');
    expect(document.querySelector('.home-inventory-label')?.textContent).not.toBe('Agents');
    expect(screen.queryByText(/^All Skills$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Drift$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Home inventory metrics/i)).not.toHaveTextContent(/^Plugins$/i);
    expect(screen.queryByLabelText(/Home inventory metrics/i)).not.toHaveTextContent(/^Commands$/i);
  });

  it('shows a positive healthy state on Home when no content needs attention', async () => {
    readCachedInventoryMock.mockResolvedValue(createAllHealthyInventorySnapshot());
    scanInventoryMock.mockResolvedValue(createAllHealthyInventorySnapshot());

    render(<App />);

    expect(await screen.findByText('Everything is in its expected state')).toBeInTheDocument();
    expect(screen.getByText(/Canonical sources present, symlinks resolved, no drift across all 3 content types\. Last checked/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /diverged-drift-skill/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /broken-mcp/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Overview queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deserves a closer look/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Priority queue$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Registry health$/i)).not.toBeInTheDocument();
  });

  it('shows Home safe repairs when only MCP missing-from-agents issues are auto-resolvable', async () => {
    const snapshot = createMcpOnlyAutoResolvableInventorySnapshot();
    readCachedInventoryMock.mockResolvedValue(snapshot);
    scanInventoryMock.mockResolvedValue(snapshot);

    render(<App />);

    const toggle = await screen.findByRole('button', { name: /Review 1 safe repair for 1 item/i });
    expect(screen.queryByText(/No safe auto-fixes available/i)).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getAllByText('Missing From Agents').length).toBeGreaterThan(0);
    expect(screen.getByText('Add to missing agents')).toBeInTheDocument();
  });

  it('recomputes Home auto-resolve batches after each successful repair', async () => {
    const initialSnapshot = createBatchAutoResolvableInventorySnapshot();
    readCachedInventoryMock.mockResolvedValue(initialSnapshot);
    scanInventoryMock.mockResolvedValue(initialSnapshot);
    makeCanonicalMock.mockResolvedValue(createAllHealthyInventorySnapshot());
    readAuditLogMock.mockResolvedValue(createAuditOperations());

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Review 2 safe repairs/i }));
    fireEvent.click(screen.getByRole('button', { name: /Apply 2 repairs/i }));

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledTimes(1);
    });
    expect(makeCanonicalMock).toHaveBeenCalledWith(expect.objectContaining({
      entity: 'skill',
      issue: 'identical-copies',
      skillName: 'batch-copy-a',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Repairs applied');
    expect(screen.getByText('2 repairs were applied.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo$/i })).not.toBeInTheDocument();
  });

  it('opens Skill and MCP detail panes from Home actions without replacing the list pane', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /diverged-drift-skill/i }));
    expect(await screen.findByRole('heading', { name: 'diverged-drift-skill', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search skills/i })).toBeInTheDocument();
    expect(getSkillsTable()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Back to Skills$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Home$/i }));
    await screen.findByRole('heading', { name: /^Home$/i, level: 2 });

    fireEvent.click(screen.getByRole('button', { name: /broken-mcp/i }));
    expect(await screen.findByRole('heading', { name: 'broken-mcp', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search MCPs/i })).toBeInTheDocument();
    expect(getMcpTable()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Back to MCPs$/i })).not.toBeInTheDocument();
  });

  it('renders Home attention as direct action controls for the items that need review', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /diverged-drift-skill/i });
    const attentionSection = getHomeAttentionSection();

    expect(screen.queryByText(/Overview queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Open any skill or MCP below/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deserves a closer look/i)).not.toBeInTheDocument();
    expect(within(attentionSection).queryByRole('table')).not.toBeInTheDocument();
    expect(within(attentionSection).getByText('Skills')).toBeInTheDocument();
    expect(within(attentionSection).getByText('MCPs')).toBeInTheDocument();
    expect(within(attentionSection).getByRole('button', { name: /diverged-drift-skill/i })).toBeInTheDocument();
    expect(within(attentionSection).getByRole('button', { name: /identical-drift-skill/i })).toBeInTheDocument();
    expect(within(attentionSection).getByRole('button', { name: /broken-mcp/i })).toBeInTheDocument();
  });

  it('keeps Home in a loading state until the first truthful inventory snapshot arrives', async () => {
    const cachedInventoryDeferred = createDeferred<SkillInventorySnapshot | null>();
    const liveInventoryDeferred = createDeferred<SkillInventorySnapshot>();
    readCachedInventoryMock.mockReturnValue(cachedInventoryDeferred.promise);
    scanInventoryMock.mockReturnValue(liveInventoryDeferred.promise);

    render(<App />);

    expect(await screen.findByRole('heading', { name: /^Home$/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/Loading your inventory summary/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Home inventory metrics/i)).not.toBeInTheDocument();

    cachedInventoryDeferred.resolve(null);
    liveInventoryDeferred.resolve(createOperationalBaselineInventorySnapshot());

    await screen.findByLabelText(/Home inventory metrics/i);
    expect(getHomeStatValue('Skills', 'on disk')).toBe('7');
    expect(getHomeAttentionSection()).toBeInTheDocument();
  });

  it('hydrates Home metrics and shell badges from the bootstrapped cached snapshot before live reconciliation resolves', async () => {
    const cachedInventoryDeferred = createDeferred<SkillInventorySnapshot | null>();
    const liveInventoryDeferred = createDeferred<SkillInventorySnapshot>();
    readCachedInventoryMock.mockReturnValue(cachedInventoryDeferred.promise);
    scanInventoryMock.mockReturnValue(liveInventoryDeferred.promise);
    Object.defineProperty(window, 'skillIndexBootstrap', {
      value: { initialInventorySnapshot: createInventorySnapshot() },
      configurable: true,
      writable: true,
    });

    render(<App />);

    expect(screen.getByRole('status', { name: /Loading Skill Index/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Home inventory metrics/i)).not.toBeInTheDocument();
    expect(await screen.findByLabelText(/Home inventory metrics/i)).toBeInTheDocument();
    expect(getHomeStatValue('Skills', 'need attention')).toBe('3');
    expect(within(getPrimaryNav()).getByRole('button', { name: /^Skills/i })).toHaveTextContent(/^Skills38$/);
    expect(within(getPrimaryNav()).getByRole('button', { name: /^MCPs/i })).toHaveTextContent(/^MCPs16$/);
    expect(screen.queryByText(/Loading the latest Home summary/i)).not.toBeInTheDocument();

    cachedInventoryDeferred.resolve(createInventorySnapshot());
    liveInventoryDeferred.resolve(createReconciledInventorySnapshot());

    await waitFor(() => {
      expect(within(getPrimaryNav()).getByRole('button', { name: /^Skills/i })).toHaveTextContent(/^Skills28$/);
      expect(within(getPrimaryNav()).getByRole('button', { name: /^MCPs/i })).toHaveTextContent(/^MCPs16$/);
    });
  });

  it('opens Settings from the separate bottom control and keeps core controls available', async () => {
    render(<App />);

    await openSettings();
    expect(screen.getByRole('switch', { name: /Show sidebar source switcher/i })).toHaveAttribute('aria-checked', 'true');
    const settingsSourceControl = screen.getByRole('radiogroup', { name: 'Inventory source' });
    expect(within(settingsSourceControl).getByRole('radio', { name: /Sandbox/i })).toHaveAttribute('aria-checked', 'true');
    expect(within(settingsSourceControl).getByRole('radio', { name: /Live/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText(/Custom scan path/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add path/i })).toBeInTheDocument();
    expect(screen.getByText('Reset representative sandbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Run$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Open onboarding$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Home$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens onboarding from the Development settings card', async () => {
    render(<App />);

    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: /^Open onboarding$/i }));

    expect(await screen.findByRole('heading', { name: /^How it fits together$/i, level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Primary/i })).not.toBeInTheDocument();
  });

  it('hides sandbox controls when shell state does not expose dev tools', async () => {
    getShellStateMock.mockResolvedValue(createShellState({ devTools: undefined }));

    render(<App />);

    await openSettings();
    expect(screen.queryByRole('radio', { name: /Sandbox/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Live/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Reset representative sandbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Open onboarding$/i })).not.toBeInTheDocument();
    expect(setInventoryModeMock).not.toHaveBeenCalled();
  });

  it('switches inventory scanning from sandbox to live for the current session from Settings', async () => {
    render(<App />);

    await waitFor(() => {
      expect(setInventoryModeMock).toHaveBeenCalledWith('sandbox');
      expect(readCachedInventoryMock).toHaveBeenCalledWith();
      expect(scanInventoryMock).toHaveBeenCalledWith();
    });

    await openSettings();
    const settingsSourceControl = screen.getByRole('radiogroup', { name: 'Inventory source' });
    fireEvent.click(within(settingsSourceControl).getByRole('radio', { name: /Live/i }));

    await waitFor(() => {
      expect(setInventoryModeMock).toHaveBeenCalledWith('live');
      expect(rescanInventoryMock).toHaveBeenCalledWith({ verifyMcpConnectivity: false });
      expect(testMcpConnectivityMock).toHaveBeenCalledTimes(1);
    });

    expect(within(settingsSourceControl).getByRole('radio', { name: /Sandbox/i })).toHaveAttribute('aria-checked', 'false');
    expect(within(settingsSourceControl).getByRole('radio', { name: /Live/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Now scanning live agent locations for this session.')).not.toBeInTheDocument();
  });

  it('explains why source controls are disabled while switching inventory source', async () => {
    const rescanDeferred = createDeferred<SkillInventorySnapshot>();
    rescanInventoryMock.mockReturnValueOnce(rescanDeferred.promise);

    render(<App />);

    await openSettings();
    const settingsSourceControl = screen.getByRole('radiogroup', { name: 'Inventory source' });
    fireEvent.click(within(settingsSourceControl).getByRole('radio', { name: /Live/i }));

    expect(await screen.findAllByText('Switching to Live...')).toHaveLength(2);
    expect(screen.getAllByText(/Refreshing inventory before showing live agent locations/i)).toHaveLength(2);
    expect(screen.getByText(/Controls are paused while Skill Index updates state/i)).toBeInTheDocument();
    expect(within(settingsSourceControl).getByRole('radio', { name: /Sandbox/i })).toBeDisabled();
    expect(within(settingsSourceControl).getByRole('radio', { name: /Live/i })).toBeDisabled();

    rescanDeferred.resolve(createReconciledInventorySnapshot());

    await waitFor(() => {
      expect(screen.queryByText('Switching to Live...')).not.toBeInTheDocument();
    });
  });

  it('tests live MCP connectivity separately after the source switch completes', async () => {
    const rescanDeferred = createDeferred<SkillInventorySnapshot>();
    const connectivityDeferred = createDeferred<SkillInventorySnapshot>();
    rescanInventoryMock.mockReturnValueOnce(rescanDeferred.promise);
    testMcpConnectivityMock.mockReturnValueOnce(connectivityDeferred.promise);

    render(<App />);

    await openSettings();
    const settingsSourceControl = screen.getByRole('radiogroup', { name: 'Inventory source' });
    fireEvent.click(within(settingsSourceControl).getByRole('radio', { name: /Live/i }));

    await waitFor(() => {
      expect(rescanInventoryMock).toHaveBeenCalledWith({ verifyMcpConnectivity: false });
    });
    expect(testMcpConnectivityMock).not.toHaveBeenCalled();
    expect(within(settingsSourceControl).getByRole('radio', { name: /Sandbox/i })).toBeDisabled();

    rescanDeferred.resolve(createInventorySnapshot());

    await waitFor(() => {
      expect(testMcpConnectivityMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Switching to Live...')).not.toBeInTheDocument();
    });

    expect(within(settingsSourceControl).getByRole('radio', { name: /Sandbox/i })).toBeEnabled();
    expect(within(settingsSourceControl).getByRole('radio', { name: /Live/i })).toBeEnabled();
    expect(screen.getByText('Testing MCP connectivity…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel MCP connectivity test/i })).toBeEnabled();

    connectivityDeferred.resolve(createReconciledInventorySnapshot());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Rescan$/i })).toBeEnabled();
      expect(within(settingsSourceControl).getByRole('radio', { name: /Sandbox/i })).toBeEnabled();
      expect(within(settingsSourceControl).getByRole('radio', { name: /Live/i })).toBeEnabled();
    });
  });

  it('cancels live MCP connectivity testing without applying the eventual test result', async () => {
    const rescanDeferred = createDeferred<SkillInventorySnapshot>();
    const connectivityDeferred = createDeferred<SkillInventorySnapshot>();
    rescanInventoryMock.mockReturnValueOnce(rescanDeferred.promise);
    testMcpConnectivityMock.mockReturnValueOnce(connectivityDeferred.promise);

    render(<App />);

    await openSettings();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Inventory source' })).getByRole('radio', { name: /Live/i }));
    rescanDeferred.resolve(createInventorySnapshot());

    await waitFor(() => {
      expect(testMcpConnectivityMock).toHaveBeenCalledTimes(1);
    });

    const cancelButton = screen.getByRole('button', { name: /Cancel MCP connectivity test/i });
    expect(cancelButton).toBeEnabled();
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(cancelMcpConnectivityTestMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /^Rescan$/i })).toBeEnabled();
    });

    connectivityDeferred.resolve(createMcpConnectionFailedInventorySnapshot());

    await openMcps();

    expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /healthy-mcp Healthy/i })).toBeInTheDocument();
  });

  it('runs manual rescans structurally before starting cancelable MCP connectivity in live mode', async () => {
    const liveShellState = createShellState({
      devTools: {
        ...createShellState().devTools!,
        inventoryMode: 'live',
      },
    });
    const rescanDeferred = createDeferred<SkillInventorySnapshot>();
    const connectivityDeferred = createDeferred<SkillInventorySnapshot>();
    getShellStateMock.mockResolvedValue(liveShellState);
    rescanInventoryMock.mockReturnValueOnce(rescanDeferred.promise);
    testMcpConnectivityMock.mockReturnValueOnce(connectivityDeferred.promise);

    render(<App />);

    await screen.findByLabelText(/Home inventory metrics/i);
    fireEvent.click(screen.getByRole('button', { name: /^Rescan$/i }));

    await waitFor(() => {
      expect(rescanInventoryMock).toHaveBeenCalledWith({ verifyMcpConnectivity: false });
    });
    expect(testMcpConnectivityMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Rescanning…$/i })).toBeDisabled();

    rescanDeferred.resolve(createInventorySnapshot());

    await waitFor(() => {
      expect(testMcpConnectivityMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Testing MCP connectivity…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancel MCP connectivity test/i })).toBeEnabled();
    });

    connectivityDeferred.resolve(createReconciledInventorySnapshot());
  });

  it('keeps issue actions enabled while MCP connectivity testing runs in the background', async () => {
    const rescanDeferred = createDeferred<SkillInventorySnapshot>();
    const connectivityDeferred = createDeferred<SkillInventorySnapshot>();
    rescanInventoryMock.mockReturnValueOnce(rescanDeferred.promise);
    testMcpConnectivityMock.mockReturnValueOnce(connectivityDeferred.promise);

    render(<App />);

    await openSettings();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Inventory source' })).getByRole('radio', { name: /Live/i }));
    rescanDeferred.resolve(createReconciledInventorySnapshot());

    await waitFor(() => {
      expect(testMcpConnectivityMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Testing MCP connectivity…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancel MCP connectivity test/i })).toBeEnabled();
    });

    await openSkills();
    fireEvent.click(getSkillRow('identical-drift-skill'));

    expect(await screen.findByRole('button', { name: /^Convert Copies to Symlinks$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^\+ Add Skill$/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /^Convert Copies to Symlinks$/i }));

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'identical-copies',
        skillName: 'identical-drift-skill',
        selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
      });
    });

    connectivityDeferred.resolve(createInventorySnapshot());
  });

  it('shows the dev inventory source in the sidebar and switches to live from there', async () => {
    render(<App />);

    await waitFor(() => {
      expect(setInventoryModeMock).toHaveBeenCalledWith('sandbox');
    });

    const sourceControl = screen.getByRole('radiogroup', { name: /Dev inventory source/i });
    expect(within(sourceControl).getByRole('radio', { name: 'Sandbox' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sourceControl).getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText(/Current inventory source/i)).toHaveTextContent('Dev mode only');
    expect(screen.getByLabelText(/Current inventory source/i)).toHaveTextContent('Inventory sourceSandbox');
    expect(screen.getByText('Visible only in dev builds.')).toBeInTheDocument();
    expect(within(sourceControl).getByRole('radio', { name: 'Sandbox' })).toHaveAttribute('tabindex', '0');
    expect(within(sourceControl).getByRole('radio', { name: 'Live' })).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(within(sourceControl).getByRole('radio', { name: 'Sandbox' }), { key: 'ArrowRight' });

    await waitFor(() => {
      expect(setInventoryModeMock).toHaveBeenCalledWith('live');
      expect(rescanInventoryMock).toHaveBeenCalledWith({ verifyMcpConnectivity: false });
      expect(testMcpConnectivityMock).toHaveBeenCalledTimes(1);
    });

    expect(within(sourceControl).getByRole('radio', { name: 'Sandbox' })).toHaveAttribute('aria-checked', 'false');
    expect(within(sourceControl).getByRole('radio', { name: 'Live' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sourceControl).getByRole('radio', { name: 'Sandbox' })).toHaveAttribute('tabindex', '-1');
    expect(within(sourceControl).getByRole('radio', { name: 'Live' })).toHaveAttribute('tabindex', '0');
  });

  it('hides the sidebar dev inventory source switcher from Settings without disabling source controls', async () => {
    setDevSidebarInventorySourceSwitcherVisibleMock.mockResolvedValueOnce(createSettingsState([], null, false));

    render(<App />);

    await openSettings();
    expect(screen.getByRole('radiogroup', { name: /Dev inventory source/i })).toBeInTheDocument();
    const sidebarSourceSwitcher = screen.getByRole('switch', { name: /Show sidebar source switcher/i });

    fireEvent.click(sidebarSourceSwitcher);

    await waitFor(() => {
      expect(setDevSidebarInventorySourceSwitcherVisibleMock).toHaveBeenCalledWith(false);
    });

    expect(screen.queryByRole('radiogroup', { name: /Dev inventory source/i })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Show sidebar source switcher/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radiogroup', { name: 'Inventory source' })).toBeInTheDocument();
  });

  it('hides the sidebar inventory source switcher outside dev mode', async () => {
    getShellStateMock.mockResolvedValue(createShellState({ devTools: undefined }));

    render(<App />);

    await openSettings();
    expect(screen.queryByRole('radiogroup', { name: /Dev inventory source/i })).not.toBeInTheDocument();
  });

  it('renders Skills as a master-detail workspace while preserving the inventory list', async () => {
    render(<App />);
    await openSkills();

    const table = getSkillsTable();

    expect(within(table).getByText('diverged-drift-skill')).toBeInTheDocument();
    expect(within(table).getByText('identical-drift-skill')).toBeInTheDocument();
    expect(within(table).getByText('dismissed-drift-skill')).toBeInTheDocument();
    expect(within(table).getByText('healthy-skill')).toBeInTheDocument();
    expect(within(table).getByText('Canonical candidate content.')).toBeInTheDocument();
    expect(within(table).getByText('Shared copy currently hidden from review.')).toBeInTheDocument();
    expect(within(table).getByText('Healthy across every installed location.')).toBeInTheDocument();
    expect(within(table).getAllByText('Identical Copies').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Diverged Copies').length).toBeGreaterThan(0);
    expect(within(table).getByText('DISMISSED ISSUES')).toBeInTheDocument();
    expect(within(table).getAllByText('Healthy').length).toBeGreaterThan(0);

    fireEvent.click(getSkillRow('diverged-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'diverged-drift-skill', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search skills/i })).toBeInTheDocument();
    expect(getSkillsTable()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Back to Skills$/i })).not.toBeInTheDocument();
  });

  it('opens the Add Skill modal and submits pasted markdown through the desktop API', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(screen.getByRole('button', { name: /Add Skill/i }));

    expect(await screen.findByRole('dialog', { name: /Add skill/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Paste Markdown/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Skill name/i }), {
      target: { value: 'my-skill-name' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /SKILL\.md contents/i }), {
      target: { value: '# my-skill\n\nUse this skill.\n' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^Add skill$/i }));

    await waitFor(() => {
      expect(addSkillMock).toHaveBeenCalledWith({
        sourceType: 'markdown',
        skillName: 'my-skill-name',
        markdown: '# my-skill\n\nUse this skill.\n',
      });
    });
    expect(screen.queryByRole('dialog', { name: /Add skill/i })).not.toBeInTheDocument();
  });

  it('submits repository URLs from the Add Skill modal using the current inventory mode', async () => {
    render(<App />);
    await openSettings();
    const settingsSourceControl = screen.getByRole('radiogroup', { name: 'Inventory source' });
    fireEvent.click(within(settingsSourceControl).getByRole('radio', { name: /Live/i }));
    await waitFor(() => {
      expect(setInventoryModeMock).toHaveBeenCalledWith('live');
      expect(rescanInventoryMock).toHaveBeenCalledWith({ verifyMcpConnectivity: false });
    });

    await openSkills();
    fireEvent.click(screen.getByRole('button', { name: /Add Skill/i }));

    const sourceInput = await screen.findByRole('textbox', { name: /Repository or skill URL/i });
    fireEvent.change(sourceInput, {
      target: { value: 'https://github.com/example/agent-skills' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Add skill$/i }));

    await waitFor(() => {
      expect(addSkillMock).toHaveBeenCalledWith({
        sourceType: 'url',
        source: 'https://github.com/example/agent-skills',
      });
    });
  });

  it('filters Skills from the summary badges above the table', async () => {
    render(<App />);
    await openSkills();

    const filterBar = screen.getByRole('toolbar', { name: /^Skill filters$/i });
    const attentionButton = within(filterBar).getByRole('button', { name: /^Needs attention/i });
    const healthyButton = within(filterBar).getByRole('button', { name: /^Healthy/i });

    fireEvent.click(attentionButton);
    expect(getSkillDataRows()).toHaveLength(3);
    expect(within(getSkillsTable()).queryByText('healthy-skill')).not.toBeInTheDocument();
    expect(attentionButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(healthyButton);
    expect(getSkillDataRows()).toHaveLength(4);
    expect(within(getSkillsTable()).queryByText('diverged-drift-skill')).not.toBeInTheDocument();
    expect(healthyButton).toHaveAttribute('aria-pressed', 'true');
    expect(attentionButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(healthyButton);
    expect(getSkillDataRows()).toHaveLength(8);
    expect(healthyButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('reconciles Home summary counts with Skills, MCPs, and Agents partitions while keeping dismissed issues out of tab badges', async () => {
    render(<App />);

    await screen.findByLabelText(/Home inventory metrics/i);
    expect(getHomeStatValue('Skills', 'on disk')).toBe('8');
    expect(getHomeStatValue('Skills', 'need attention')).toBe('3');
    expect(getHomeStatValue('MCPs', 'servers')).toBe('6');
    expect(getHomeStatValue('MCPs', 'need attention')).toBe('1');

    expect(within(getPrimaryNav()).getByRole('button', { name: /^Skills/i })).toHaveTextContent(/^Skills38$/);
    expect(within(getPrimaryNav()).getByRole('button', { name: /^MCPs/i })).toHaveTextContent(/^MCPs16$/);
    expect(within(getPrimaryNav()).getByRole('button', { name: /^Agents/i })).toHaveTextContent(
      new RegExp(`^Agents${createInventorySnapshot().agentCounts?.installedAgents ?? 0}$`),
    );

    await openSkills();
    expect(getSkillDataRows()).toHaveLength(8);

    await openMcps();
    expect(getMcpDataRows()).toHaveLength(6);
    const mcpFilters = screen.getByRole('toolbar', { name: /^MCP filters$/i });
    expect(within(mcpFilters).getByRole('button', { name: /^Needs attention1$/i })).toBeInTheDocument();
    expect(within(mcpFilters).getByRole('button', { name: /^Healthy4$/i })).toBeInTheDocument();

    await openAgents();
    expect(getAgentDataRows()).toHaveLength(AGENT_CATALOG.length);
    fireEvent.click(screen.getByRole('button', { name: /^Not installed/i }));
    expect(getAgentDataRows()).toHaveLength(AGENT_CATALOG.length - 4);
  });

  it('renders MCPs as a master-detail workspace while keeping only active issues in the caution badge', async () => {
    render(<App />);
    await openMcps();

    const table = getMcpTable();

    expect(within(table).getByText('broken-mcp')).toBeInTheDocument();
    expect(within(table).getByText('muted-mcp')).toBeInTheDocument();
    expect(within(table).getByText('healthy-mcp')).toBeInTheDocument();
    expect(within(table).getByText('claude-only-mcp')).toBeInTheDocument();
    expect(within(table).getAllByText('Definition Mismatch').length).toBeGreaterThan(0);
    expect(within(table).getByText('DISMISSED ISSUES')).toBeInTheDocument();
    expect(within(table).getAllByText('Healthy').length).toBeGreaterThan(0);
    expect(within(getPrimaryNav()).getByRole('button', { name: /^MCPs/i })).toHaveTextContent(/^MCPs16$/);

    fireEvent.click(getMcpRow('broken-mcp'));
    expect(await screen.findByRole('heading', { name: 'broken-mcp', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search MCPs/i })).toBeInTheDocument();
    expect(getMcpTable()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Back to MCPs$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Detected Definitions')).toBeInTheDocument();
    expect(screen.getByText('Definition Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Compared Fields')).toBeInTheDocument();
  });

  it('opens the Add Server modal and submits a command server through the desktop API', async () => {
    render(<App />);
    await openMcps();

    fireEvent.click(screen.getByRole('button', { name: /Add Server/i }));

    expect(await screen.findByRole('dialog', { name: /Add Server/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/One argument per line/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/BASE_URL=https:\/\/api\.example\.com/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^URL$/i }));
    expect(screen.getByPlaceholderText(/X-API-Key/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Command$/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /Server name/i }), {
      target: { value: 'local-filesystem' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /^Command$/i }), {
      target: { value: 'npx' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Arguments/i }), {
      target: { value: '-y\n@modelcontextprotocol/server-filesystem\n/tmp/project' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Environment/i }), {
      target: { value: 'API_TOKEN=test-token' },
    });

    expect(screen.queryByText('Targets')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Add Server$/i }));

    await waitFor(() => {
      expect(addMcpServerMock).toHaveBeenCalledWith({
        name: 'local-filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project'],
        env: {
          API_TOKEN: 'test-token',
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Add Server/i })).not.toBeInTheDocument();
    });
  });

  it('filters MCPs from the summary badges above the table', async () => {
    render(<App />);
    await openMcps();

    const filterBar = screen.getByRole('toolbar', { name: /^MCP filters$/i });
    const healthyButton = within(filterBar).getByRole('button', { name: /^Healthy/i });

    fireEvent.click(healthyButton);
    expect(getMcpDataRows()).toHaveLength(4);
    expect(within(getMcpTable()).getByText('healthy-mcp')).toBeInTheDocument();
    expect(within(getMcpTable()).queryByText('broken-mcp')).not.toBeInTheDocument();
    expect(healthyButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(healthyButton);
    expect(getMcpDataRows()).toHaveLength(6);
    expect(healthyButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps MCP selection in a side-by-side detail pane instead of navigating away from the list', async () => {
    render(<App />);
    await openMcps();

    fireEvent.click(getMcpRow('broken-mcp'));
    expect(await screen.findByRole('heading', { name: 'broken-mcp', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search MCPs/i })).toBeInTheDocument();
    expect(getMcpTable()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Back to MCPs$/i })).not.toBeInTheDocument();
  });

  it('renders Agents as grouped installed and not-installed rows with path evidence', async () => {
    render(<App />);
    await openAgents();

    expect(within(getPrimaryNav()).getByRole('button', { name: /^Agents/i })).toHaveTextContent(
      new RegExp(`^Agents${createInventorySnapshot().agentCounts?.installedAgents ?? 0}$`),
    );

    const list = getAgentsList();
    expect(getAgentDataRows()).toHaveLength(AGENT_CATALOG.length);

    expect(within(list).getByText('INSTALLED')).toBeInTheDocument();
    expect(within(list).getByText('NOT INSTALLED')).toBeInTheDocument();
    expect(within(list).getAllByText('Skills source')).toHaveLength(2);
    expect(within(list).getAllByText('MCP / config')).toHaveLength(2);
    expect(within(list).getByText('Codex')).toBeInTheDocument();
    expect(within(list).getByText('Claude Code')).toBeInTheDocument();
    expect(within(list).getByText('Claude Desktop')).toBeInTheDocument();
    expect(within(list).getByText('Cursor')).toBeInTheDocument();
    expect(within(list).getByText('Factory')).toBeInTheDocument();
    expect(within(list).getByText('OpenCode')).toBeInTheDocument();
    expect(within(list).getByText('Windsurf')).toBeInTheDocument();
    expect(within(getAgentRow('Codex')).getByText('~/.agents/skills')).toBeInTheDocument();
    expect(within(getAgentRow('Claude Code')).getByText('~/.claude/skills')).toBeInTheDocument();
    expect(within(getAgentRow('Claude Desktop')).getByText('Cloud account managed')).toBeInTheDocument();
    expect(within(getAgentRow('Claude Desktop')).queryByText('No local skills folder to install into')).not.toBeInTheDocument();
    expect(within(getAgentRow('Claude Desktop')).getByText('~/.skillindex/sandbox/Library/Application Support/Claude/claude_desktop_config.json')).toBeInTheDocument();
    expect(within(getAgentRow('OpenCode')).getByText('~/.agents/skills')).toBeInTheDocument();
    expect(within(getAgentRow('Windsurf')).getByText('~/.codeium/windsurf/skills')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Not installed/i }));
    expect(getAgentDataRows()).toHaveLength(AGENT_CATALOG.length - 4);
    expect(within(getAgentsList()).getByText('Cursor')).toBeInTheDocument();
    expect(within(getAgentsList()).getByText('OpenCode')).toBeInTheDocument();
    expect(within(getAgentsList()).getByText('Windsurf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Not installed/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters skill names case-insensitively and keeps the selected detail beside the list', async () => {
    render(<App />);
    await openSkills();

    fireEvent.change(screen.getByRole('searchbox', { name: /Search skills/i }), { target: { value: 'mixed-case' } });
    expect(screen.getByText('MiXeD-Case-Skill')).toBeInTheDocument();
    expect(screen.queryByText('healthy-skill')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: /Search skills/i }), { target: { value: '' } });
    fireEvent.click(getSkillRow('diverged-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'diverged-drift-skill', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search skills/i })).toBeInTheDocument();
    expect(getSkillsTable()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Back to Skills$/i })).not.toBeInTheDocument();
  });

  it('filters MCPs from the header search field', async () => {
    render(<App />);
    await openMcps();

    fireEvent.change(screen.getByRole('searchbox', { name: /Search MCPs/i }), { target: { value: 'broken' } });

    expect(screen.getByText('broken-mcp')).toBeInTheDocument();
    expect(screen.queryByText('healthy-mcp')).not.toBeInTheDocument();
    expect(screen.queryByText('muted-mcp')).not.toBeInTheDocument();
  });

  it('filters Agents from the header search field', async () => {
    render(<App />);
    await openAgents();

    fireEvent.change(screen.getByRole('searchbox', { name: /Search agents/i }), { target: { value: 'windsurf' } });

    expect(screen.getByText('Windsurf')).toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
    expect(screen.queryByText('Factory')).not.toBeInTheDocument();
  });

  it('shows installed agents before not-installed agents in the default list order', async () => {
    render(<App />);
    await openAgents();

    const sectionTitles = Array.from(getAgentsList().querySelectorAll('.inventory-section-title h3')).map((node) => node.textContent);
    expect(sectionTitles).toEqual(['INSTALLED', 'NOT INSTALLED']);
  });

  it('focuses the active list search field when Command+F is pressed', async () => {
    render(<App />);

    await openSkills();
    within(getPrimaryNav()).getByRole('button', { name: /^Skills/i }).focus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.getByRole('searchbox', { name: /Search skills/i })).toHaveFocus();

    await openMcps();
    within(getPrimaryNav()).getByRole('button', { name: /^MCPs/i }).focus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.getByRole('searchbox', { name: /Search MCPs/i })).toHaveFocus();

    await openAgents();
    within(getPrimaryNav()).getByRole('button', { name: /^Agents/i }).focus();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.getByRole('searchbox', { name: /Search agents/i })).toHaveFocus();
  });

  it('navigates Skill and MCP rows with J/K without stealing typed search input', async () => {
    render(<App />);

    await openSkills();
    expect(screen.getByLabelText('List keyboard shortcuts')).toHaveTextContent(/J\s*↑/i);
    expect(screen.getByLabelText('List keyboard shortcuts')).toHaveTextContent(/K\s*↓/i);
    expect(screen.getByLabelText('List keyboard shortcuts')).not.toHaveTextContent(/Shift/i);

    fireEvent.keyDown(window, { key: 'k' });
    expect(getSkillDataRows()[0]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'k' });
    expect(getSkillDataRows()[1]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'K', shiftKey: true });
    expect(getSkillDataRows()[1]).toHaveAttribute('aria-pressed', 'true');

    const skillSearch = screen.getByRole('searchbox', { name: /Search skills/i });
    skillSearch.focus();
    fireEvent.keyDown(skillSearch, { key: 'j' });
    expect(getSkillDataRows()[1]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'j' });
    expect(getSkillDataRows()[0]).toHaveAttribute('aria-pressed', 'true');

    await openMcps();
    expect(screen.getByLabelText('List keyboard shortcuts')).toHaveTextContent(/J\s*↑/i);
    expect(screen.getByLabelText('List keyboard shortcuts')).toHaveTextContent(/K\s*↓/i);
    expect(screen.getByLabelText('List keyboard shortcuts')).not.toHaveTextContent(/Shift/i);

    fireEvent.keyDown(window, { key: 'k' });
    expect(getMcpDataRows()[0]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'j' });
    expect(getMcpDataRows()[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows and activates detail shortcuts for skill repair and dismissal actions', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('single-source-skill'));
    expect(await screen.findByRole('heading', { name: 'single-source-skill', level: 3 })).toBeInTheDocument();
    const repairButton = screen.getByRole('button', { name: /^Use as Universal$/i });
    expect(within(repairButton).getByText('F')).toHaveClass('detail-inspector-panel__footer-shortcut');
    expect(repairButton).toHaveAttribute('aria-keyshortcuts', 'F');

    fireEvent.keyDown(window, { key: 'f' });
    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith(expect.objectContaining({
        entity: 'skill',
        issue: 'missing-canonical',
        skillName: 'single-source-skill',
      }));
    });

    cleanup();
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('identical-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'identical-drift-skill', level: 3 })).toBeInTheDocument();
    const dismissButton = screen.getByRole('button', { name: /^Dismiss issues with this skill$/i });
    expect(within(dismissButton).getByText('D')).toHaveClass('detail-inspector-panel__footer-shortcut');
    expect(dismissButton).toHaveAttribute('aria-keyshortcuts', 'D');

    fireEvent.keyDown(window, { key: 'd' });
    await waitFor(() => {
      expect(dismissDriftMock).toHaveBeenCalledWith({ skillName: 'identical-drift-skill' });
    });
  });

  it('shows and activates detail shortcuts for MCP repair and dismissal actions', async () => {
    render(<App />);
    await openMcps();

    fireEvent.click(getMcpRow('broken-mcp'));
    expect(await screen.findByRole('heading', { name: 'broken-mcp', level: 3 })).toBeInTheDocument();
    const repairButton = screen.getByRole('button', { name: /^Apply Selected Definition Across Agents$/i });
    expect(within(repairButton).getByText('F')).toHaveClass('detail-inspector-panel__footer-shortcut');
    expect(repairButton).toHaveAttribute('aria-keyshortcuts', 'F');

    fireEvent.keyDown(window, { key: 'f' });
    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith(expect.objectContaining({
        entity: 'mcp',
        mcpName: 'broken-mcp',
      }));
    });

    cleanup();
    render(<App />);
    await openMcps();

    fireEvent.click(getMcpRow('broken-mcp'));
    expect(await screen.findByRole('heading', { name: 'broken-mcp', level: 3 })).toBeInTheDocument();
    const dismissButton = screen.getByRole('button', { name: /^Dismiss issues with this MCP$/i });
    expect(within(dismissButton).getByText('D')).toHaveClass('detail-inspector-panel__footer-shortcut');
    expect(dismissButton).toHaveAttribute('aria-keyshortcuts', 'D');

    fireEvent.keyDown(window, { key: 'd' });
    await waitFor(() => {
      expect(dismissDriftMock).toHaveBeenCalledWith({ mcpName: 'broken-mcp' });
    });
  });

  it('shows subagent dismissal failures as toasts instead of inline banners', async () => {
    const snapshot = structuredClone(representativeInventorySnapshot);
    readCachedInventoryMock.mockResolvedValue(snapshot);
    scanInventoryMock.mockResolvedValue(snapshot);
    dismissDriftMock.mockRejectedValueOnce(new Error('Subagent dismissal is not supported yet.'));

    render(<App />);
    await openSubagents();

    fireEvent.click(getSubagentRow('reviewer'));
    expect(await screen.findByRole('heading', { name: 'reviewer', level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss issues with this subagent$/i }));

    await waitFor(() => {
      expect(dismissDriftMock).toHaveBeenCalledWith({ subagentName: 'reviewer' });
    });

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('Dismissal failed');
    expect(toast).toHaveTextContent('Subagent dismissal is not supported yet.');
    expect(document.querySelector('.inline-error-banner')).toBeNull();
  });

  it('starts with a selected source for diverged canonicalization and lets you switch it on the skill detail page', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('diverged-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'diverged-drift-skill', level: 3 })).toBeInTheDocument();

    const makeCanonicalButton = screen.getByRole('button', { name: /^Use as Universal$/i });
    expect(makeCanonicalButton).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /\/Users\/arjitjaiswal\/\.skillindex\/sandbox\/\.claude/i }));
    expect(makeCanonicalButton).toBeEnabled();
    expect(screen.getByRole('button', { name: /\/Users\/arjitjaiswal\/\.skillindex\/sandbox\/\.claude/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('auto-resolves identical drift without source picking and re-homes the current selection into Healthy', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('identical-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'identical-drift-skill', level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Convert Copies to Symlinks$/i }));

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'identical-copies',
        skillName: 'identical-drift-skill',
        selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
      });
      expect(screen.getByRole('heading', { name: 'identical-drift-skill', level: 3 })).toBeInTheDocument();
      expect(screen.getByRole('searchbox', { name: /Search skills/i })).toBeInTheDocument();
    });
  });

  it('dismisses an active drift warning and keeps the dismissed row discoverable in Skills', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('identical-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'identical-drift-skill', level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss issues with this skill$/i }));

    await waitFor(() => {
      expect(dismissDriftMock).toHaveBeenCalledWith({ skillName: 'identical-drift-skill' });
      expect(screen.getByRole('heading', { name: 'identical-drift-skill', level: 3 })).toBeInTheDocument();
    });
    expect(await screen.findByRole('button', { name: /^Undismiss issues with this skill$/i })).toBeInTheDocument();

    await clearSkillsSelection();
    expect(getSkillRow('identical-drift-skill')).toBeInTheDocument();
    expect(screen.getAllByText('Dismissed').length).toBeGreaterThan(0);
  });

  it('re-homes a dismissed identical drift into Healthy and clears stale dismissed Home residue after canonicalization', async () => {
    readCachedInventoryMock.mockResolvedValue(createDismissedIdenticalDriftInventorySnapshot());
    scanInventoryMock.mockResolvedValue(createDismissedIdenticalDriftInventorySnapshot());
    makeCanonicalMock.mockResolvedValue(createCanonicalizedMutedIdenticalInventorySnapshot());

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('identical-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'identical-drift-skill', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Undismiss issues with this skill$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Convert Copies to Symlinks$/i }));

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'identical-copies',
        skillName: 'identical-drift-skill',
        selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
      });
      expect(screen.getByRole('heading', { name: 'identical-drift-skill', level: 3 })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Undismiss issues with this skill$/i })).not.toBeInTheDocument();
    });

    await clearSkillsSelection();
    expect(getSkillRow('identical-drift-skill')).toBeInTheDocument();
    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Skills/i })).toHaveTextContent(/^Skills28$/);

    fireEvent.click(screen.getByRole('button', { name: /^Home$/i }));
    await screen.findByLabelText(/Home inventory metrics/i);
    expect(getHomeStatValue('Skills', 'on disk')).toBe('8');
    expect(getHomeStatValue('Skills', 'need attention')).toBe('2');
  });

  it('keeps canonicalization hidden for healthy skills and available for plugin-managed skills', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('healthy-skill'));
    expect(await screen.findByRole('heading', { name: 'healthy-skill', level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Use as Universal$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Locations/i }));
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
    expect(screen.getByText('Local files not supported')).toBeInTheDocument();
    expect(screen.queryByText('Cloud account managed')).not.toBeInTheDocument();

    await clearSkillsSelection();
    fireEvent.click(getSkillRow('mixed-plugin-skill'));
    expect(await screen.findByRole('heading', { name: /mixed-plugin-skill/i, level: 3 })).toHaveAccessibleName(
      /This skill was installed via one or more plugins/i,
    );
    expect(screen.queryByRole('button', { name: /export detached copy/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Convert Copies to Symlinks$/i })).toBeEnabled();
    expect(screen.getByText(/Read-only plugin skill outside the universal/i)).toBeInTheDocument();
  });

  it('does not show plugin overlap classification actions in the skill problems footer', async () => {
    const snapshot = createInventorySnapshotWithPluginOverlapCandidate();
    readCachedInventoryMock.mockResolvedValue(snapshot);
    scanInventoryMock.mockResolvedValue(snapshot);

    render(<App />);
    await openSkills();

    const overlapRow = screen.getByText('Selected plugin overlap skill.').closest('button');
    expect(overlapRow).not.toBeNull();
    fireEvent.click(overlapRow as HTMLElement);
    expect(await screen.findByRole('heading', { name: /frontend-design/i, level: 3 })).toBeInTheDocument();
    expect(screen.getAllByText('Diverged Copies').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Mark equivalent$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ignore overlap$/i })).not.toBeInTheDocument();
  });

  it('keeps a genuinely empty inventory empty instead of auto-seeding representative fixtures', async () => {
    readCachedInventoryMock.mockResolvedValue(null);
    scanInventoryMock.mockResolvedValue(createEmptyInventorySnapshot());

    render(<App />);
    await openSkills();

    expect(seedRepresentativeFixturesMock).not.toHaveBeenCalled();
    expect(screen.getByText('No skills were found in the locations Skill Index scanned.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /^Skills table$/i })).not.toBeInTheDocument();
  });

  it('adds and removes custom scan paths from Settings while reconciling Skills detail', async () => {
    rescanInventoryMock
      .mockResolvedValueOnce(createInventorySnapshotWithCustomPath())
      .mockResolvedValueOnce(createInventorySnapshot());

    render(<App />);
    await openSettings();

    fireEvent.change(screen.getByLabelText(/Custom scan path/i), { target: { value: '/tmp/skillindex/custom-scan' } });
    fireEvent.click(screen.getByRole('button', { name: /Add path/i }));

    await waitFor(() => {
      expect(addCustomScanPathMock).toHaveBeenCalledWith('/tmp/skillindex/custom-scan');
      expect(rescanInventoryMock).toHaveBeenCalledTimes(1);
    });

    const customScanPathRow = (await screen.findByText('/tmp/skillindex/custom-scan')).closest('.settings-path-row');
    expect(customScanPathRow).toBeInstanceOf(HTMLElement);
    expect(within(customScanPathRow as HTMLElement).getByText('2')).toBeInTheDocument();

    await openSkills();
    fireEvent.click(getSkillRow('healthy-skill'));

    expect(await screen.findByRole('heading', { name: 'healthy-skill', level: 3 })).toBeInTheDocument();
    expect(screen.getAllByText('/tmp/skillindex/custom-scan/healthy-skill.md').length).toBeGreaterThan(0);

    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: '/tmp/skillindex/custom-scan' }));

    await waitFor(() => {
      expect(removeCustomScanPathMock).toHaveBeenCalledWith('/tmp/skillindex/custom-scan');
      expect(rescanInventoryMock).toHaveBeenCalledTimes(2);
    });
  });

  it('explains why custom scan path controls are disabled while settings are refreshing', async () => {
    const rescanDeferred = createDeferred<SkillInventorySnapshot>();
    rescanInventoryMock.mockReturnValueOnce(rescanDeferred.promise);

    render(<App />);
    await openSettings();

    fireEvent.change(screen.getByLabelText(/Custom scan path/i), { target: { value: '/tmp/skillindex/custom-scan' } });
    fireEvent.click(screen.getByRole('button', { name: /Add path/i }));

    expect(await screen.findByText('Adding scan path...')).toBeInTheDocument();
    expect(screen.getByText(/Refreshing inventory with the new directory/i)).toBeInTheDocument();
    expect(screen.getByText(/Controls are paused while Skill Index updates state/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Adding path/i })).toBeDisabled();

    rescanDeferred.resolve(createInventorySnapshotWithCustomPath());

    await waitFor(() => {
      expect(screen.queryByText('Adding scan path...')).not.toBeInTheDocument();
    });
  });

  it('sets and clears the preferred canonical source path from Settings', async () => {
    const preferredPath = '/tmp/repos/arjit-skills';
    setPreferredCanonicalSourcePathMock.mockResolvedValueOnce(createSettingsState([], preferredPath));
    clearPreferredCanonicalSourcePathMock.mockResolvedValueOnce(createSettingsState());

    render(<App />);
    await openSettings();

    fireEvent.change(screen.getByLabelText(/Preferred canonical source path/i), { target: { value: preferredPath } });
    fireEvent.click(screen.getByRole('button', { name: /Set preferred path/i }));

    await waitFor(() => {
      expect(setPreferredCanonicalSourcePathMock).toHaveBeenCalledWith(preferredPath);
      expect(rescanInventoryMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByRole('button', { name: preferredPath })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: preferredPath }));

    await waitFor(() => {
      expect(clearPreferredCanonicalSourcePathMock).toHaveBeenCalledTimes(1);
      expect(rescanInventoryMock).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps newer watcher truth when a settings-driven rescan resolves with an older snapshot', async () => {
    const rescanDeferred = createDeferred<SkillInventorySnapshot>();
    rescanInventoryMock.mockReturnValueOnce(rescanDeferred.promise);

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('healthy-skill'));
    expect(await screen.findByRole('heading', { name: 'healthy-skill', level: 3 })).toBeInTheDocument();

    await openSettings();
    fireEvent.change(screen.getByLabelText(/Custom scan path/i), { target: { value: '/tmp/skillindex/custom-scan' } });
    fireEvent.click(screen.getByRole('button', { name: /Add path/i }));

    await waitFor(() => {
      expect(addCustomScanPathMock).toHaveBeenCalledWith('/tmp/skillindex/custom-scan');
      expect(rescanInventoryMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      inventoryUpdatedListener?.(createInventorySnapshotWithWatcherDriftChange());
    });
    rescanDeferred.resolve(createInventorySnapshotWithCustomPath());

    await openSkills();
    fireEvent.click(getSkillRow('healthy-skill'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'healthy-skill', level: 3 })).toBeInTheDocument();
      expect(screen.getAllByText('~/.factory').length).toBeGreaterThan(0);
      expect(screen.queryByText('/tmp/skillindex/custom-scan/healthy-skill.md')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Convert Copies to Symlinks$/i })).toBeEnabled();
    });
  });

  it('promotes newly installed agents across Home, Skills, and Agents after a manual rescan', async () => {
    readCachedInventoryMock.mockResolvedValue(createOperationalBaselineInventorySnapshot());
    scanInventoryMock.mockResolvedValue(createOperationalBaselineInventorySnapshot());
    rescanInventoryMock.mockResolvedValue(createOperationalPromotedInventorySnapshot());

    render(<App />);

    await screen.findByLabelText(/Home inventory metrics/i);
    expect(within(getPrimaryNav()).getByRole('button', { name: /^Agents/i })).toHaveTextContent(
      new RegExp(`^Agents${createOperationalBaselineInventorySnapshot().agentCounts?.installedAgents ?? 0}$`),
    );

    fireEvent.click(screen.getByRole('button', { name: /^Rescan$/i }));

    await waitFor(() => {
      expect(rescanInventoryMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Inventory refreshed/i)).toBeInTheDocument();
    });

    await openAgents();
    expect(within(getAgentsList()).getByText('Windsurf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Not installed/i })).toBeInTheDocument();

    await openSkills();
    expect(await screen.findByText('single-source-skill')).toBeInTheDocument();
  });

  it('re-homes a dismissed selection and clears stale dismissed Home residue when its disappearing source is removed on rescan', async () => {
    readCachedInventoryMock.mockResolvedValue(createVanishingSourceMutedInventorySnapshot());
    scanInventoryMock.mockResolvedValue(createVanishingSourceMutedInventorySnapshot());
    rescanInventoryMock.mockResolvedValue(createVanishingSourceRemovedInventorySnapshot());

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('vanishing-muted-skill'));
    expect(await screen.findByRole('heading', { name: 'vanishing-muted-skill', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Undismiss issues with this skill$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Rescan$/i }));

    await waitFor(() => {
      expect(rescanInventoryMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('heading', { name: 'vanishing-muted-skill', level: 3 })).toBeInTheDocument();
      expect(screen.queryByText(/currently dismissed in Skills/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Undismiss issues with this skill$/i })).not.toBeInTheDocument();
    });

    await clearSkillsSelection();
    expect(screen.getByText('vanishing-muted-skill')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Home$/i }));
    await screen.findByLabelText(/Home inventory metrics/i);
    expect(getHomeStatValue('Skills', 'need attention')).toBe('3');
  });

  it('keeps a selected skill coherent when watcher-driven updates change its drift state in place', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('healthy-skill'));
    expect(await screen.findByRole('heading', { name: 'healthy-skill', level: 3 })).toBeInTheDocument();

    act(() => {
      inventoryUpdatedListener?.(createInventorySnapshotWithWatcherDriftChange());
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'healthy-skill', level: 3 })).toBeInTheDocument();
    });
    expect(screen.getAllByText('Identical Copies').length).toBeGreaterThan(0);
    expect(screen.getAllByText('~/.factory').length).toBeGreaterThan(0);
  });

  it('clears a stale canonical source selection when watcher-driven updates replace diverged candidates in place', async () => {
    readCachedInventoryMock.mockResolvedValue(createInventorySnapshot());
    scanInventoryMock.mockResolvedValue(createInventorySnapshot());

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('diverged-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'diverged-drift-skill', level: 3 })).toBeInTheDocument();

    const makeCanonicalButton = screen.getByRole('button', { name: /^Use as Universal$/i });
    fireEvent.click(screen.getByRole('button', { name: /\/Users\/arjitjaiswal\/\.skillindex\/sandbox\/\.claude/i }));
    expect(makeCanonicalButton).toBeEnabled();

    act(() => {
      inventoryUpdatedListener?.(createInventorySnapshotWithWatcherChangedDivergedCandidates());
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'diverged-drift-skill', level: 3 })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /\/Users\/arjitjaiswal\/\.skillindex\/sandbox\/\.claude/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Use as Universal$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^Use as Universal$/i })).toHaveAttribute(
        'title',
        'Choose a skill version before resolving this issue.',
      );
    });
  });

  it('refreshes detail diagnostics in place when live updates change duplicate candidates', async () => {
    readCachedInventoryMock.mockResolvedValue(createInventorySnapshotWithDiagnosticRichSkill());
    scanInventoryMock.mockResolvedValue(createInventorySnapshotWithDiagnosticRichSkill());

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('diagnostic-rich-skill'));
    expect(await screen.findByRole('heading', { name: 'diagnostic-rich-skill', level: 3 })).toBeInTheDocument();

    act(() => {
      inventoryUpdatedListener?.(createInventorySnapshotWithUpdatedDiagnosticRichSkill());
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'diagnostic-rich-skill', level: 3 })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Diverged Copies 4 versions/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Invalid Definition 1 issue/i }));
    expect(screen.getByText(/Missing required field: name/i)).toBeInTheDocument();
  });

  it('derives the redesigned inspector model shape from the same representative detail fixtures', () => {
    const skillSnapshot = createInventorySnapshotWithDiagnosticRichSkill();
    const skill = skillSnapshot.skills.find((entry) => entry.name === 'diagnostic-rich-skill');
    const skillSourceIndex = new Map(skillSnapshot.sources.map((source) => [source.id, source]));
    const skillAgentIndex = new Map((skillSnapshot.agents ?? []).map((agent) => [agent.id, agent]));
    const mcpSnapshot = createInventorySnapshot();
    const mcp = mcpSnapshot.mcps?.find((entry) => entry.name === 'broken-mcp');
    const mcpAgentIndex = new Map((mcpSnapshot.agents ?? []).map((agent) => [agent.id, agent]));

    expect(skill).toBeDefined();
    expect(mcp).toBeDefined();

    const skillModel = buildSkillInspectorModel(skill!, skillSourceIndex, {
      selectedProblemKey: 'diverged-copies',
      selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
    }, skillAgentIndex);
    const mcpModel = buildMcpInspectorModel(mcp!, {
      selectedProblemKey: 'definition-mismatch',
      selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude.json',
    }, mcpAgentIndex);

    expect(skillModel.header.metadata.map((row) => row.label)).toEqual([
      'Selected version',
      'Universal',
      'Locations',
    ]);
    expect(skillModel.problemSections).toEqual([
      { title: 'Variant resolution', problemKeys: ['diverged-copies'] },
      { title: 'Structural repair', problemKeys: ['invalid-definition'] },
    ]);
    expect(skillModel.selectedVariantPath).toBe('/Users/arjitjaiswal/.skillindex/sandbox/.claude');
    expect(skillModel.provenanceRows.map((row) => row.label)).toContain('Universal');

    expect(mcpModel.header.metadata.map((row) => row.label)).toEqual([
      'Selected definition',
      'Reference definition',
      'Locations',
    ]);
    expect(mcpModel.problemSections).toEqual([
      { title: 'Variant resolution', problemKeys: ['definition-mismatch'] },
      { title: 'Structural repair', problemKeys: ['invalid-definition'] },
    ]);
    expect(mcpModel.selectedVariantPath).toBe('/Users/arjitjaiswal/.skillindex/sandbox/.claude.json');
    expect(mcpModel.activeProblem.kind).toBe('variant-resolution');
    if (mcpModel.activeProblem.kind === 'variant-resolution') {
      expect(mcpModel.activeProblem.diffTitle).toBe(MCP_DETAIL_DIFF_TITLE);
    }
  });

  it('renders the redesigned skill inspector with problems, variant selection, and a single canonical action', async () => {
    readCachedInventoryMock.mockResolvedValue(createInventorySnapshotWithDiagnosticRichSkill());
    scanInventoryMock.mockResolvedValue(createInventorySnapshotWithDiagnosticRichSkill());

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('diagnostic-rich-skill'));
    expect(await screen.findByRole('heading', { name: 'diagnostic-rich-skill', level: 3 })).toBeInTheDocument();

    expect(screen.getByText('2 problems')).toBeInTheDocument();
    expect(screen.getByText('Select one to inspect')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Diverged Copies 3 versions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invalid Definition 1 issue/i })).toBeInTheDocument();
    expect(screen.getByText('Detected Versions')).toBeInTheDocument();
    expect(screen.getByText(DETAIL_DIFF_TITLE)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Sandbox Claude .*\/Users\/arjitjaiswal\/\.skillindex\/sandbox\/\.claude/i }));
    expect(screen.getByText(DETAIL_DIFF_TITLE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Use as Universal$/i }));

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'diverged-copies',
        skillName: 'diagnostic-rich-skill',
        selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
      });
    });
  });

  it('lets an accepted plugin alternate become Universal from the Locations tab', async () => {
    const snapshot = createInventorySnapshotWithAcceptedPluginAlternate();
    readCachedInventoryMock.mockResolvedValue(snapshot);
    scanInventoryMock.mockResolvedValue(snapshot);
    applyCapabilityActionMock.mockResolvedValue(snapshot);

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('handoff-notes-with-static'));
    expect(await screen.findByRole('heading', { name: /handoff-notes-with-static/i, level: 3 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Locations/i }));

    const pluginPaths = screen.getByRole('list', { name: 'Plugin Paths' });
    const claudeRow = within(pluginPaths).getByText('Claude Plugin').closest('.detail-inspector-panel__location-row');
    expect(claudeRow).not.toBeNull();
    expect(within(claudeRow as HTMLElement).getByText('Accepted Alternate')).toBeInTheDocument();

    fireEvent.click(within(claudeRow as HTMLElement).getByRole('button', { name: /^Make Universal$/i }));

    await waitFor(() => {
      expect(applyCapabilityActionMock).toHaveBeenCalledWith({
        entity: 'skill',
        action: 'choose-universal-version',
        skillName: 'example-workflow-kit:handoff-notes-with-static',
        selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes-with-static',
      });
    });
  });

  it('renders the redesigned MCP inspector with problem rows and one focused diff surface', async () => {
    render(<App />);
    await openMcps();

    fireEvent.click(getMcpRow('broken-mcp'));
    expect(await screen.findByRole('heading', { name: 'broken-mcp', level: 3 })).toBeInTheDocument();

    expect(screen.getByText('2 problems')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Definition Mismatch 2 definitions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invalid Definition 1 issue/i })).toBeInTheDocument();
    expect(screen.getByText('Detected Definitions')).toBeInTheDocument();
    expect(screen.getByText('Definition Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Compared Fields')).toBeInTheDocument();
    expect(screen.getByText('Agent-Local Settings')).toBeInTheDocument();
    expect(screen.getByText('Raw Configs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Apply Selected Definition Across Agents$/i })).toBeEnabled();
  });

  it('renders identical copies as a structural repair flow without a diff chooser', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('identical-drift-skill'));
    expect(await screen.findByRole('heading', { name: 'identical-drift-skill', level: 3 })).toBeInTheDocument();

    expect(screen.getByText('1 problem')).toBeInTheDocument();
    expect(screen.getByText('Matching Copies')).toBeInTheDocument();
    expect(screen.queryByText(DETAIL_DIFF_TITLE)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Convert Copies to Symlinks$/i }));

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'identical-copies',
        skillName: 'identical-drift-skill',
        selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
      });
    });
  });

  it('keeps missing-canonical skill repairs available through the redesigned inspector', async () => {
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('single-source-skill'));
    expect(await screen.findByRole('heading', { name: 'single-source-skill', level: 3 })).toBeInTheDocument();

    const createCanonicalButton = screen.getByRole('button', { name: /^Use as Universal$/i });
    expect(createCanonicalButton).toBeEnabled();

    fireEvent.click(createCanonicalButton);

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'missing-canonical',
        skillName: 'single-source-skill',
        selectedVariantPath: '/Users/arjitjaiswal/.skillindex/sandbox/.codeium/windsurf',
      });
    });
  });

  it('shows visible confirmation after a skill repair resolves', async () => {
    readAuditLogMock
      .mockResolvedValueOnce([])
      .mockResolvedValue(createAuditOperations());
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('single-source-skill'));
    expect(await screen.findByRole('heading', { name: 'single-source-skill', level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Use as Universal$/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Skill updated');
    expect(screen.getByText('single-source-skill was updated.')).toBeInTheDocument();
    const toastUndoButton = screen.getByRole('button', { name: /^Undo$/i });
    expect(toastUndoButton.querySelector('.app-toast-action-icon')).toBeInTheDocument();
    fireEvent.click(toastUndoButton);

    await waitFor(() => {
      expect(undoAuditOperationMock).toHaveBeenCalledWith('audit-operation-1');
    });
  });

  it('shows blocked feedback when an immediate toast undo cannot be applied', async () => {
    readAuditLogMock
      .mockResolvedValueOnce([])
      .mockResolvedValue(createAuditOperations());
    undoAuditOperationMock.mockResolvedValueOnce({
      auditLog: createAuditOperations({ status: 'undo-blocked', undoState: 'blocked' }),
      inventorySnapshot: createInventorySnapshot(),
      settingsState: createSettingsState(),
    });
    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('single-source-skill'));
    expect(await screen.findByRole('heading', { name: 'single-source-skill', level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Use as Universal$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Undo$/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('Undo blocked');
    expect(screen.queryByText('The last change was undone.')).not.toBeInTheDocument();
  });

  it('shows visible confirmation after an MCP repair resolves', async () => {
    render(<App />);
    await openMcps();

    fireEvent.click(getMcpRow('broken-mcp'));
    expect(await screen.findByRole('heading', { name: 'broken-mcp', level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Apply Selected Definition Across Agents$/i }));

    expect(await screen.findByRole('status')).toHaveTextContent('MCP server updated');
    expect(screen.getByText('broken-mcp was updated.')).toBeInTheDocument();
  });

  it('holds plugin skill repairs in the Applying state after a fast resolve', async () => {
    const snapshot = structuredClone(representativeInventorySnapshot);
    const pluginSkill = snapshot.skills.find((skill) => skill.name === 'plugin-readonly-skill');
    if (!pluginSkill) {
      throw new Error('Missing representative plugin skill fixture: plugin-readonly-skill');
    }
    pluginSkill.structuralState = 'missing-symlinks';
    pluginSkill.isDrifted = true;
    pluginSkill.driftPresentation = 'active';
    pluginSkill.issueReasons = ['missing-symlinks'];
    pluginSkill.locations = pluginSkill.locations.map((location) => ({
      ...location,
      canonical: true,
    }));
    pluginSkill.detailDiagnostics = {
      ...pluginSkill.detailDiagnostics,
      missingInstallSources: [
        {
          sourceId: 'sandbox-agents',
          label: 'Sandbox .agents',
          kind: 'canonical',
          scope: 'sandbox',
          writable: true,
          canonical: false,
        },
      ],
    };
    readCachedInventoryMock.mockResolvedValue(snapshot);
    scanInventoryMock.mockResolvedValue(snapshot);
    let resolveRepair: ((nextSnapshot: SkillInventorySnapshot) => void) | null = null;
    makeCanonicalMock.mockReturnValue(new Promise<SkillInventorySnapshot>((resolve) => {
      resolveRepair = resolve;
    }));

    render(<App />);
    await openSkills();

    fireEvent.change(screen.getByRole('searchbox', { name: /Search skills/i }), { target: { value: 'plugin-readonly' } });
    fireEvent.click(getSkillRow('plugin-readonly-skill'));
    expect(await screen.findByRole('heading', { name: /^plugin-readonly-skill/i, level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Create Missing Symlinks$/i }));

    expect(await screen.findByRole('button', { name: /^Applying/i })).toBeDisabled();

    vi.useFakeTimers();
    await act(async () => {
      resolveRepair?.(snapshot);
      await Promise.resolve();
    });

    expect(screen.getByRole('status')).toHaveTextContent('Skill updated');
    expect(screen.getByRole('button', { name: /^Applying/i })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(199);
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: /^Applying/i })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: /^Create Missing Symlinks$/i })).toBeEnabled();
  });

  it('routes missing-symlink skill repairs through the shared canonicalization action', async () => {
    readCachedInventoryMock.mockResolvedValue(representativeInventorySnapshot);
    scanInventoryMock.mockResolvedValue(representativeInventorySnapshot);

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('missing-symlink-skill'));
    expect(await screen.findByRole('heading', { name: 'missing-symlink-skill', level: 3 })).toBeInTheDocument();

    const repairButton = screen.getByRole('button', { name: /^Create Missing Symlinks$/i });
    expect(repairButton).toBeEnabled();

    fireEvent.click(repairButton);

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'missing-symlinks',
        skillName: 'missing-symlink-skill',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/skills/missing-symlink-skill',
      });
    });
  });

  it('routes broken symlink repairs through the shared canonicalization action', async () => {
    const snapshot = createRepresentativeBrokenSymlinkSkillSnapshot();
    readCachedInventoryMock.mockResolvedValue(snapshot);
    scanInventoryMock.mockResolvedValue(snapshot);

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('broken-symlink-skill'));
    expect(await screen.findByRole('heading', { name: 'broken-symlink-skill', level: 3 })).toBeInTheDocument();

    const repairButton = screen.getByRole('button', { name: /^Repair Symlinks$/i });
    expect(repairButton).toBeEnabled();

    fireEvent.click(repairButton);

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'broken-symlink',
        skillName: 'broken-symlink-skill',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/skills/missing-symlink-skill',
      });
    });
  });

  it('routes wrong symlink target repairs through the shared canonicalization action', async () => {
    const snapshot = createRepresentativeWrongSymlinkTargetSkillSnapshot();
    readCachedInventoryMock.mockResolvedValue(snapshot);
    scanInventoryMock.mockResolvedValue(snapshot);

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('wrong-symlink-target-skill'));
    expect(await screen.findByRole('heading', { name: 'wrong-symlink-target-skill', level: 3 })).toBeInTheDocument();

    const repairButton = screen.getByRole('button', { name: /^Repair Symlinks$/i });
    expect(repairButton).toBeEnabled();

    fireEvent.click(repairButton);

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'skill',
        issue: 'wrong-symlink-target',
        skillName: 'wrong-symlink-target-skill',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/skills/missing-symlink-skill',
      });
    });
  });

  it('does not show a fake primary repair action for invalid skill definitions', async () => {
    readCachedInventoryMock.mockResolvedValue(createInventorySnapshotWithDiagnosticRichSkill());
    scanInventoryMock.mockResolvedValue(createInventorySnapshotWithDiagnosticRichSkill());

    render(<App />);
    await openSkills();

    fireEvent.click(getSkillRow('diagnostic-rich-skill'));
    expect(await screen.findByRole('heading', { name: 'diagnostic-rich-skill', level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Invalid Definition 1 issue/i }));

    expect(screen.getByText('Definition Issues')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Use as Universal$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Convert Copies to Symlinks$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Create Missing Symlinks$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Repair Symlinks$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Invalid definitions need a manual edit before Skill Index can repair or sync them.')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(INVALID_DEFINITION_HELP_TEXT);
    expect(screen.queryByRole('button', { name: /^Open File to Fix$/i })).not.toBeInTheDocument();
  });

  it('renders missing-from-agents as a structural MCP repair flow with a single disabled action', async () => {
    readCachedInventoryMock.mockResolvedValue(representativeInventorySnapshot);
    scanInventoryMock.mockResolvedValue(representativeInventorySnapshot);

    render(<App />);
    await openMcps();

    fireEvent.click(getMcpRow('missing-from-agents-mcp'));
    expect(await screen.findByRole('heading', { name: 'missing-from-agents-mcp', level: 3 })).toBeInTheDocument();

    expect(screen.getByText('1 problem')).toBeInTheDocument();
    expect(screen.getByText('Affected Agents')).toBeInTheDocument();
    expect(screen.queryByText(DETAIL_DIFF_TITLE)).not.toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: /^Add MCP to Agents$/i });
    expect(addButton).toBeEnabled();

    fireEvent.click(addButton);

    await waitFor(() => {
      expect(makeCanonicalMock).toHaveBeenCalledWith({
        entity: 'mcp',
        issue: 'missing-from-agents',
        mcpName: 'missing-from-agents-mcp',
        selectedVariantPath: '~/.skillindex/sandbox/.agents/mcp.json',
      });
    });
  });

  it('does not show a fake primary repair action for invalid MCP definitions', async () => {
    render(<App />);
    await openMcps();

    fireEvent.click(getMcpRow('broken-mcp'));
    expect(await screen.findByRole('heading', { name: 'broken-mcp', level: 3 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Invalid Definition 1 issue/i }));

    expect(screen.getByText('Definition Issues')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Apply Selected Definition Across Agents$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add MCP to Agents$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Invalid definitions need a manual edit before Skill Index can repair or sync them.')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(INVALID_DEFINITION_HELP_TEXT);
    expect(screen.queryByRole('button', { name: /^Open File to Fix$/i })).not.toBeInTheDocument();
  });
});

function createShellState(overrides: Partial<AppShellState> = {}): AppShellState {
  return {
    appName: 'Skill Index',
    username: 'arjitjaiswal',
    dataDir: DEFAULT_DATA_DIR,
    cacheFile: `${DEFAULT_DATA_DIR}/cache.json`,
    configFile: `${DEFAULT_DATA_DIR}/config.json`,
    liveCanonicalUserSkillsDir: '/Users/arjitjaiswal/.agents/skills',
    devTools: {
      sandboxEnabled: true,
      inventoryMode: 'sandbox',
      sandboxRoot: DEFAULT_SANDBOX_ROOT,
      sandboxAgentsDir: `${DEFAULT_SANDBOX_ROOT}/.agents`,
      sandboxCanonicalUserSkillsDir: `${DEFAULT_SANDBOX_ROOT}/.agents/skills`,
      sandboxAgentsSkillsDir: `${DEFAULT_SANDBOX_ROOT}/.agents/skills`,
      fixturesDir: `${DEFAULT_DATA_DIR}/fixtures`,
    },
    preloadStatus: 'ready',
    ...overrides,
  };
}

function getHomeStatValue(cardLabel: string, subLabel: string): string {
  const cards = [...document.querySelectorAll<HTMLElement>('.home-inventory-cell')];
  const card = cards.find((candidate) => candidate.querySelector('.home-inventory-label')?.textContent === cardLabel);
  if (!card) {
    return '';
  }

  if (subLabel === 'need attention') {
    const attentionText = card.querySelector('.home-inventory-attention')?.textContent ?? '';
    return attentionText.match(/\d+/)?.[0] ?? '0';
  }

  const total = card.querySelector('.home-inventory-total');
  const unit = card.querySelector('.home-inventory-unit');
  if (unit?.textContent !== subLabel) {
    return '';
  }

  return [...(total?.childNodes ?? [])]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim() ?? '')
    .join('');
}

function createSettingsState(
  customScanPaths: string[] = [],
  preferredCanonicalSourcePath: string | null = null,
  onboardingCompletedAtOrShowDevSidebarInventorySourceSwitcher: string | null | boolean = '2026-05-19T00:00:00.000Z',
  showDevSidebarInventorySourceSwitcher = true,
): SettingsState {
  const onboardingCompletedAt = typeof onboardingCompletedAtOrShowDevSidebarInventorySourceSwitcher === 'boolean'
    ? '2026-05-19T00:00:00.000Z'
    : onboardingCompletedAtOrShowDevSidebarInventorySourceSwitcher;

  return {
    customScanPaths,
    onboardingCompletedAt,
    preferredCanonicalSourcePath,
    showDevSidebarInventorySourceSwitcher: typeof onboardingCompletedAtOrShowDevSidebarInventorySourceSwitcher === 'boolean'
      ? onboardingCompletedAtOrShowDevSidebarInventorySourceSwitcher
      : showDevSidebarInventorySourceSwitcher,
  };
}

function createAuditOperations(overrides: Partial<AuditOperation> = {}): AuditOperation[] {
  return createAuditOperationsWithActionCount(1, overrides);
}

function createAuditOperationsWithActionCount(
  actionCount: number,
  overrides: Partial<AuditOperation> = {},
): AuditOperation[] {
  const actions: AuditOperation['actions'] = Array.from({ length: actionCount }, (_, index) => {
    const rowNumber = index + 1;
    const actionPath = `${DEFAULT_SANDBOX_ROOT}/.factory/skills/missing-symlink-skill-${rowNumber}`;
    return {
      id: `audit-action-${rowNumber}`,
      operationId: 'audit-operation-1',
      kind: 'create-symlink',
      title: 'Created symlink',
      summary: `${actionPath} now points to ${DEFAULT_SANDBOX_ROOT}/.agents/skills/missing-symlink-skill.`,
      status: 'completed',
      path: actionPath,
      targetPath: `${DEFAULT_SANDBOX_ROOT}/.agents/skills/missing-symlink-skill`,
      before: { kind: 'absent' },
      after: {
        kind: 'symlink',
        symlinkTarget: `${DEFAULT_SANDBOX_ROOT}/.agents/skills/missing-symlink-skill`,
      },
      completedAt: '2026-05-16T18:00:01.000Z',
    };
  });
  const operation: AuditOperation = {
    id: 'audit-operation-1',
    kind: 'resolve-skill-issue',
    title: 'Resolved Missing Symlinks for missing-symlink-skill',
    summary: '2 paths changed.',
    startedAt: '2026-05-16T18:00:00.000Z',
    completedAt: '2026-05-16T18:00:01.000Z',
    status: 'completed',
    actor: 'app',
    sourceMode: 'sandbox',
    entity: { type: 'skill', name: 'missing-symlink-skill' },
    undoState: 'available',
    actionCount,
    actions,
    ...overrides,
  };

  return [operation];
}

function createInventorySnapshot(): SkillInventorySnapshot {
  return withSnapshotDetailDiagnostics({
    scannedAt: '2026-04-09T00:00:00.000Z',
    sourceIds: ['sandbox-agents', 'sandbox-claude', 'sandbox-factory', 'sandbox-windsurf', 'sandbox-plugin-pack'],
    sources: [
      {
        id: 'sandbox-agents',
        label: 'Sandbox .agents',
        canonical: true,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/Users/arjitjaiswal/.skillindex/sandbox/.agents/skills',
      },
      {
        id: 'sandbox-claude',
        label: 'Sandbox Claude',
        canonical: false,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/Users/arjitjaiswal/.skillindex/sandbox/.claude/skills',
      },
      {
        id: 'sandbox-factory',
        label: 'Sandbox Factory',
        canonical: false,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/Users/arjitjaiswal/.skillindex/sandbox/.factory/skills',
      },
      {
        id: 'sandbox-windsurf',
        label: 'Sandbox Windsurf',
        canonical: false,
        kind: 'agent',
        writable: true,
        scope: 'sandbox',
        skillsDir: '/Users/arjitjaiswal/.skillindex/sandbox/.codeium/windsurf/skills',
      },
      {
        id: 'sandbox-plugin-pack',
        label: 'Sandbox Plugin bundle',
        canonical: false,
        kind: 'plugin',
        writable: false,
        scope: 'sandbox',
        skillsDir: '/Users/arjitjaiswal/.skillindex/sandbox/plugins/skills',
      },
    ],
    skills: [
      {
        name: 'diverged-drift-skill',
        structuralState: 'diverged-drift',
        isDrifted: true,
        driftPresentation: 'active',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            sourceId: 'sandbox-agents',
            sourceLabel: 'Sandbox .agents',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-04T00:00:00.000Z',
            canonical: true,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'aaa',
          },
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
            sourceId: 'sandbox-claude',
            sourceLabel: 'Sandbox Claude',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-04T00:00:02.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
            contentHash: 'bbb',
          },
        ],
        diff: {
          primaryPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
          primarySourceLabel: 'Sandbox Claude',
          comparisons: [
            {
              path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
              sourceLabel: 'Sandbox .agents',
              lines: [
                {
                  type: 'context',
                  text: '# Diverged drift skill',
                },
                {
                  type: 'removed',
                  text: 'Canonical candidate content.',
                },
                {
                  type: 'added',
                  text: 'Conflicting content from Claude.',
                },
              ],
            },
          ],
        },
      },
      {
        name: 'dismissed-drift-skill',
        structuralState: 'identical-drift',
        isDrifted: true,
        driftPresentation: 'dismissed',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            sourceId: 'sandbox-agents',
            sourceLabel: 'Sandbox .agents',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-05T00:00:00.000Z',
            canonical: true,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'fff',
          },
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
            sourceId: 'sandbox-claude',
            sourceLabel: 'Sandbox Claude',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-05T00:00:01.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
            contentHash: 'fff',
          },
        ],
      },
      {
        name: 'healthy-skill',
        structuralState: 'healthy',
        isDrifted: false,
        driftPresentation: 'none',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            sourceId: 'sandbox-agents',
            sourceLabel: 'Sandbox .agents',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-01T00:00:00.000Z',
            canonical: true,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'ccc',
          },
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
            sourceId: 'sandbox-claude',
            sourceLabel: 'Sandbox Claude',
            sourceScope: 'sandbox',
            fileType: 'symlink',
            modifiedAt: '2026-01-01T00:00:00.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            symlinkTarget: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'ccc',
          },
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
            sourceId: 'sandbox-factory',
            sourceLabel: 'Sandbox Factory',
            sourceScope: 'sandbox',
            fileType: 'symlink',
            modifiedAt: '2026-01-01T00:00:00.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            symlinkTarget: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'ccc',
          },
        ],
      },
      {
        name: 'identical-drift-skill',
        structuralState: 'identical-drift',
        isDrifted: true,
        driftPresentation: 'active',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            sourceId: 'sandbox-agents',
            sourceLabel: 'Sandbox .agents',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-03T00:00:00.000Z',
            canonical: true,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'ddd',
          },
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
            sourceId: 'sandbox-factory',
            sourceLabel: 'Sandbox Factory',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-03T00:00:01.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
            contentHash: 'ddd',
          },
        ],
      },
      {
        name: 'MiXeD-Case-Skill',
        structuralState: 'healthy',
        isDrifted: false,
        driftPresentation: 'none',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            sourceId: 'sandbox-agents',
            sourceLabel: 'Sandbox .agents',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-06T00:00:00.000Z',
            canonical: true,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'ggg',
          },
        ],
      },
      {
        name: 'mixed-plugin-skill',
        structuralState: 'identical-drift',
        isDrifted: true,
        driftPresentation: 'active',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
            sourceId: 'sandbox-factory',
            sourceLabel: 'Sandbox Factory',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-06T00:00:30.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
            contentHash: 'jjj',
          },
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/plugins',
            sourceId: 'sandbox-plugin-pack',
            sourceLabel: 'Sandbox Plugin bundle',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-06T00:00:31.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/plugins',
            contentHash: 'jjj',
          },
        ],
      },
      {
        name: 'plugin-readonly-skill',
        structuralState: 'single-source-noncanonical',
        isDrifted: false,
        driftPresentation: 'none',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/plugins',
            sourceId: 'sandbox-plugin-pack',
            sourceLabel: 'Sandbox Plugin bundle',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-07T00:00:00.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/plugins',
            contentHash: 'iii',
          },
        ],
      },
      {
        name: 'single-source-skill',
        structuralState: 'single-source-noncanonical',
        isDrifted: false,
        driftPresentation: 'none',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.codeium/windsurf',
            sourceId: 'sandbox-windsurf',
            sourceLabel: 'Sandbox Windsurf',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-02T00:00:00.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.codeium/windsurf',
            contentHash: 'eee',
            definitionText: [
              '---',
              'name: single-source-skill',
              'description: Installed in a single location outside the universal .agents folder.',
              '---',
              '# Single source skill',
              'Only Windsurf has this copy right now.',
            ].join('\n'),
          },
        ],
      },
    ],
    counts: {
      totalSkills: 8,
      driftedSkills: 3,
      healthySkills: 2,
      singleSourceSkills: 2,
      identicalDriftSkills: 3,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 1,
    },
  });
}

function createInventorySnapshotWithAcceptedPluginAlternate(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const skillName = 'example-workflow-kit:handoff-notes-with-static';
  const agentsPath = `${DEFAULT_SANDBOX_ROOT}/.agents/skills/${skillName}`;
  const claudePluginPath = `${DEFAULT_SANDBOX_ROOT}/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills/handoff-notes-with-static`;
  const codexPluginPath = `${DEFAULT_SANDBOX_ROOT}/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills/handoff-notes-with-static`;
  const agentsLocation: SkillRecord['locations'][number] = {
    path: agentsPath,
    entrypointPath: `${agentsPath}/SKILL.md`,
    sourceId: 'sandbox-agents',
    sourceLabel: 'Sandbox .agents',
    sourceScope: 'sandbox',
    installKind: 'directory',
    fileType: 'real-file',
    modifiedAt: '2026-05-15T03:00:00.000Z',
    canonical: true,
    resolvedPath: agentsPath,
    contentHash: 'static-handoff',
  };
  const claudePluginLocation: SkillRecord['locations'][number] = createAcceptedPluginLocation({
    host: 'claude',
    sourceId: 'plugin:sandbox:claude:example-workflow-kit@sandbox-gallery:5.1.0',
    sourceLabel: 'Claude Plugin example-workflow-kit',
    path: claudePluginPath,
    contentHash: 'claude-handoff',
  });
  const codexPluginLocation: SkillRecord['locations'][number] = createAcceptedPluginLocation({
    host: 'codex',
    sourceId: 'plugin:sandbox:codex:example-workflow-kit@sandbox-curated:5.1.0',
    sourceLabel: 'Codex Plugin example-workflow-kit',
    path: codexPluginPath,
    contentHash: 'codex-handoff',
  });
  const installSources = [agentsLocation, claudePluginLocation, codexPluginLocation].map((location) => {
    const source = snapshot.sources.find((candidate) => candidate.id === location.sourceId);
    return {
      sourceId: location.sourceId,
      label: location.sourceLabel,
      kind: source?.kind ?? (location.provenance?.kind === 'plugin' ? 'plugin' as const : 'agent' as const),
      scope: location.sourceScope,
      writable: source?.writable ?? location.provenance?.kind !== 'plugin',
      canonical: location.canonical,
    };
  });
  const handoffSkill: SkillRecord = {
    name: skillName,
    displayName: 'handoff-notes-with-static',
    description: 'Codex plugin variant with one writable static install.',
    structuralState: 'missing-symlinks',
    isDrifted: true,
    driftPresentation: 'active',
    issueReasons: ['missing-symlinks'],
    locations: [agentsLocation, claudePluginLocation, codexPluginLocation],
    detailDiagnostics: {
      duplicateCandidates: [],
      installSources,
      missingInstallSources: [],
      definitionIssues: [],
      acceptedAlternates: [
        {
          kind: 'plugin',
          host: 'claude',
          pluginId: 'example-workflow-kit@sandbox-gallery',
          pluginVersion: '5.1.0',
          pluginSkillName: 'handoff-notes-with-static',
          reason: 'kept-separate',
        },
      ],
    },
  };

  return {
    ...snapshot,
    sourceIds: [
      ...snapshot.sourceIds,
      'plugin:sandbox:claude:example-workflow-kit@sandbox-gallery:5.1.0',
      'plugin:sandbox:codex:example-workflow-kit@sandbox-curated:5.1.0',
    ],
    sources: [
      ...snapshot.sources,
      createPluginSource({
        host: 'claude',
        sourceId: 'plugin:sandbox:claude:example-workflow-kit@sandbox-gallery:5.1.0',
        label: 'Claude Plugin example-workflow-kit',
        skillsDir: `${DEFAULT_SANDBOX_ROOT}/.claude/plugins/cache/sandbox-gallery/example-workflow-kit/5.1.0/skills`,
      }),
      createPluginSource({
        host: 'codex',
        sourceId: 'plugin:sandbox:codex:example-workflow-kit@sandbox-curated:5.1.0',
        label: 'Codex Plugin example-workflow-kit',
        skillsDir: `${DEFAULT_SANDBOX_ROOT}/.codex/plugins/cache/sandbox-curated/example-workflow-kit/5.1.0/skills`,
      }),
    ],
    skills: [handoffSkill, ...snapshot.skills].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    counts: {
      ...snapshot.counts,
      totalSkills: snapshot.counts.totalSkills + 1,
      driftedSkills: snapshot.counts.driftedSkills + 1,
    },
  };
}

function createInventorySnapshotWithPluginOverlapCandidate(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const pluginPath = `${DEFAULT_SANDBOX_ROOT}/plugins/skills/frontend-design`;
  const localPath = `${DEFAULT_SANDBOX_ROOT}/.agents/skills/plugin-overlap-primary`;
  const equivalentPath = `${DEFAULT_SANDBOX_ROOT}/.factory/skills/frontend-design`;
  const pluginLocation: SkillRecord['locations'][number] = {
    path: pluginPath,
    entrypointPath: `${pluginPath}/SKILL.md`,
    sourceId: 'sandbox-plugin-pack',
    sourceLabel: 'Sandbox Plugin bundle',
    sourceScope: 'sandbox',
    installKind: 'directory',
    fileType: 'real-file',
    modifiedAt: '2026-05-16T00:00:00.000Z',
    canonical: false,
    resolvedPath: pluginPath,
    contentHash: 'plugin-overlap-plugin',
    provenance: {
      kind: 'plugin',
      plugin: {
        host: 'claude',
        pluginId: 'frontend-design@sandbox-gallery',
        version: '1.0.0',
      },
      sourcePath: pluginPath,
      discoveredAt: '2026-05-16T00:00:00.000Z',
    },
    canonicalRole: 'materialized-copy',
    mutability: 'read-only-managed',
  };
  const localLocation: SkillRecord['locations'][number] = {
    path: localPath,
    entrypointPath: `${localPath}/SKILL.md`,
    sourceId: 'sandbox-agents',
    sourceLabel: 'Sandbox .agents',
    sourceScope: 'sandbox',
    installKind: 'directory',
    fileType: 'real-file',
    modifiedAt: '2026-05-16T00:00:01.000Z',
    canonical: true,
    resolvedPath: localPath,
    contentHash: 'plugin-overlap-local',
    provenance: {
      kind: 'universal',
      sourcePath: localPath,
      discoveredAt: '2026-05-16T00:00:01.000Z',
    },
    canonicalRole: 'canonical',
    mutability: 'writable',
  };
  const equivalentLocation: SkillRecord['locations'][number] = {
    path: equivalentPath,
    entrypointPath: `${equivalentPath}/SKILL.md`,
    sourceId: 'sandbox-factory',
    sourceLabel: 'Sandbox Factory',
    sourceScope: 'sandbox',
    installKind: 'directory',
    fileType: 'real-file',
    modifiedAt: '2026-05-16T00:00:02.000Z',
    canonical: false,
    resolvedPath: equivalentPath,
    contentHash: 'plugin-overlap-equivalent',
    provenance: {
      kind: 'agent-local',
      sourcePath: equivalentPath,
      discoveredAt: '2026-05-16T00:00:02.000Z',
    },
    canonicalRole: 'materialized-copy',
    mutability: 'writable',
  };

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    skills: [
      ...snapshot.skills,
      {
        name: 'plugin-overlap-primary',
        displayName: 'frontend-design',
        description: 'Selected plugin overlap skill.',
        structuralState: 'diverged-drift',
        isDrifted: true,
        driftPresentation: 'active',
        issueReasons: ['diverged-copies'],
        locations: [localLocation, pluginLocation],
      },
      {
        name: 'frontend-design',
        description: 'Separate local frontend-design skill.',
        structuralState: 'healthy',
        isDrifted: false,
        driftPresentation: 'none',
        issueReasons: [],
        locations: [equivalentLocation],
      },
    ],
    counts: {
      ...snapshot.counts,
      totalSkills: snapshot.counts.totalSkills + 2,
      driftedSkills: snapshot.counts.driftedSkills + 1,
      healthySkills: snapshot.counts.healthySkills + 1,
      divergedDriftSkills: snapshot.counts.divergedDriftSkills + 1,
    },
  });
}

function createAcceptedPluginLocation({
  contentHash,
  host,
  path: locationPath,
  sourceId,
  sourceLabel,
}: {
  contentHash: string;
  host: 'claude' | 'codex';
  path: string;
  sourceId: string;
  sourceLabel: string;
}): SkillRecord['locations'][number] {
  return {
    path: locationPath,
    entrypointPath: `${locationPath}/SKILL.md`,
    sourceId,
    sourceLabel,
    sourceScope: 'sandbox',
    installKind: 'directory',
    fileType: 'real-file',
    modifiedAt: '2026-05-15T04:00:00.000Z',
    canonical: false,
    resolvedPath: locationPath,
    contentHash,
    provenance: {
      kind: 'plugin',
      plugin: {
        host,
        pluginId: host === 'claude' ? 'example-workflow-kit@sandbox-gallery' : 'example-workflow-kit@sandbox-curated',
        version: '5.1.0',
      },
      sourcePath: locationPath,
      discoveredAt: '2026-05-15T04:00:00.000Z',
    },
    canonicalRole: 'canonical',
    mutability: 'read-only-managed',
  };
}

function createPluginSource({
  host,
  label,
  skillsDir,
  sourceId,
}: {
  host: 'claude' | 'codex';
  label: string;
  skillsDir: string;
  sourceId: string;
}): SkillInventorySnapshot['sources'][number] {
  const pluginId = host === 'claude' ? 'example-workflow-kit@sandbox-gallery' : 'example-workflow-kit@sandbox-curated';
  const rootPath = pathWithoutTrailingSegment(skillsDir, '/skills');
  return {
    id: sourceId,
    label,
    canonical: false,
    kind: 'plugin',
    writable: false,
    scope: 'sandbox',
    skillsDir,
    plugin: {
      host,
      pluginId,
      pluginName: 'example-workflow-kit',
      version: '5.1.0',
      rootPath,
      manifestPath: `${rootPath}/${host === 'claude' ? '.claude-plugin' : '.codex-plugin'}/plugin.json`,
    },
  };
}

function pathWithoutTrailingSegment(value: string, trailingSegment: string): string {
  return value.endsWith(trailingSegment) ? value.slice(0, -trailingSegment.length) : value;
}

function createEmptyInventorySnapshot(): SkillInventorySnapshot {
  return {
    scannedAt: '2026-04-09T00:00:00.000Z',
    sourceIds: [],
    sources: [],
    skills: [],
    counts: {
      totalSkills: 0,
      driftedSkills: 0,
      healthySkills: 0,
      singleSourceSkills: 0,
      identicalDriftSkills: 0,
      divergedDriftSkills: 0,
      dismissedDriftSkills: 0,
    },
  };
}

function createReconciledInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:05.000Z',
    skills: snapshot.skills
      .map<SkillInventorySnapshot['skills'][number]>((skill) => {
        if (skill.name !== 'identical-drift-skill') {
          return skill;
        }

        return {
          ...skill,
          structuralState: 'healthy',
          isDrifted: false,
          driftPresentation: 'none',
          locations: [skill.locations[0]],
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    counts: {
      totalSkills: 8,
      driftedSkills: 2,
      healthySkills: 3,
      singleSourceSkills: 2,
      identicalDriftSkills: 2,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 1,
    },
  });
}

function createMcpConnectionFailedInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const mcps = (snapshot.mcps ?? []).map<NonNullable<SkillInventorySnapshot['mcps']>[number]>((mcp) => {
    if (mcp.name !== 'healthy-mcp') {
      return mcp;
    }

    return {
      ...mcp,
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['connection-failed'],
      locations: mcp.locations.map((location, index) => index === 0
        ? {
            ...location,
            connectivity: {
              status: 'failed',
              checkedAt: '2026-05-28T12:00:00.000Z',
              error: 'Canceled run should not apply this result.',
            },
          }
        : location),
    };
  });

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:10.000Z',
    mcps,
    mcpCounts: {
      totalMcps: mcps.length,
      attentionMcps: mcps.filter((mcp) => mcp.presentation === 'active' && mcp.status === 'needs-attention').length,
      healthyMcps: mcps.filter((mcp) => mcp.status === 'healthy').length,
      dismissedAttentionMcps: mcps.filter((mcp) => mcp.presentation === 'dismissed').length,
    },
  });
}

function createCanonicalizedDivergedInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const divergedSkill = snapshot.skills.find((skill) => skill.name === 'diverged-drift-skill')!;

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:06.000Z',
    skills: snapshot.skills
      .map<SkillInventorySnapshot['skills'][number]>((skill) => {
        if (skill.name !== 'diverged-drift-skill') {
          return skill;
        }

        return {
          ...divergedSkill,
          structuralState: 'healthy',
          isDrifted: false,
          driftPresentation: 'none',
          diff: undefined,
          locations: [
            {
              ...divergedSkill.locations[0],
              contentHash: 'bbb',
            },
            {
              ...divergedSkill.locations[1],
              fileType: 'symlink',
              resolvedPath: divergedSkill.locations[0].path,
              symlinkTarget: divergedSkill.locations[0].path,
              contentHash: 'bbb',
            },
          ],
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    counts: {
      totalSkills: 8,
      driftedSkills: 2,
      healthySkills: 3,
      singleSourceSkills: 2,
      identicalDriftSkills: 3,
      divergedDriftSkills: 0,
      dismissedDriftSkills: 1,
    },
  });
}

function createDismissedIdenticalDriftInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const identicalSkill = snapshot.skills.find((skill) => skill.name === 'identical-drift-skill')!;

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:07.000Z',
    skills: snapshot.skills
      .map<SkillInventorySnapshot['skills'][number]>((skill) => {
        if (skill.name !== 'identical-drift-skill') {
          return skill;
        }

        return {
          ...identicalSkill,
          driftPresentation: 'dismissed',
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    counts: {
      totalSkills: 8,
      driftedSkills: 2,
      healthySkills: 2,
      singleSourceSkills: 2,
      identicalDriftSkills: 3,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 2,
    },
  });
}

function createCanonicalizedMutedIdenticalInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createDismissedIdenticalDriftInventorySnapshot();
  const identicalSkill = snapshot.skills.find((skill) => skill.name === 'identical-drift-skill')!;

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:08.000Z',
    skills: snapshot.skills
      .map<SkillInventorySnapshot['skills'][number]>((skill) => {
        if (skill.name !== 'identical-drift-skill') {
          return skill;
        }

        return {
          ...identicalSkill,
          structuralState: 'healthy',
          isDrifted: false,
          driftPresentation: 'none',
          driftSignature: undefined,
          diff: undefined,
          locations: [identicalSkill.locations[0]],
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    counts: {
      totalSkills: 8,
      driftedSkills: 2,
      healthySkills: 3,
      singleSourceSkills: 2,
      identicalDriftSkills: 2,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 1,
    },
    homeSummary: {
      skills: {
        total: 8,
        healthy: 5,
        needsAttention: 3,
      },
      mcps: {
        total: 6,
        healthy: 4,
        needsAttention: 2,
      },
      installedAgents: 3,
    },
  });
}

function createInventorySnapshotWithCustomPath(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const customSource = {
    id: 'custom:/tmp/skillindex/custom-scan',
    label: 'Custom /tmp/skillindex/custom-scan',
    canonical: false,
    kind: 'custom' as const,
    writable: false,
    scope: 'custom' as const,
    skillsDir: '/tmp/skillindex/custom-scan',
  };
  const healthySkill = snapshot.skills.find((skill) => skill.name === 'healthy-skill');

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:10.000Z',
    sourceIds: [...snapshot.sourceIds, customSource.id],
    sources: [...snapshot.sources, customSource],
    skills: [
      {
        ...snapshot.skills.find((skill) => skill.name === 'diverged-drift-skill')!,
      },
      {
        ...snapshot.skills.find((skill) => skill.name === 'dismissed-drift-skill')!,
      },
      {
        ...healthySkill!,
        structuralState: 'identical-drift',
        isDrifted: true,
        driftPresentation: 'active',
        driftSignature: JSON.stringify({
          name: 'healthy-skill',
          customScanPath: '/tmp/skillindex/custom-scan',
        }),
        locations: [
          ...healthySkill!.locations,
          {
            path: '/tmp/skillindex/custom-scan/healthy-skill.md',
            sourceId: customSource.id,
            sourceLabel: customSource.label,
            sourceScope: 'custom',
            fileType: 'real-file',
            modifiedAt: '2026-01-07T00:00:00.000Z',
            canonical: false,
            resolvedPath: '/tmp/skillindex/custom-scan/healthy-skill.md',
            contentHash: 'ccc',
          },
        ],
      },
      {
        name: 'custom-only-skill',
        structuralState: 'single-source-noncanonical',
        isDrifted: false,
        driftPresentation: 'none',
        locations: [
          {
            path: '/tmp/skillindex/custom-scan/custom-only-skill.md',
            sourceId: customSource.id,
            sourceLabel: customSource.label,
            sourceScope: 'custom',
            fileType: 'real-file',
            modifiedAt: '2026-01-07T00:00:01.000Z',
            canonical: false,
            resolvedPath: '/tmp/skillindex/custom-scan/custom-only-skill.md',
            contentHash: 'hhh',
          },
        ],
      },
      {
        ...snapshot.skills.find((skill) => skill.name === 'identical-drift-skill')!,
      },
      {
        ...snapshot.skills.find((skill) => skill.name === 'MiXeD-Case-Skill')!,
      },
      {
        ...snapshot.skills.find((skill) => skill.name === 'mixed-plugin-skill')!,
      },
      {
        ...snapshot.skills.find((skill) => skill.name === 'plugin-readonly-skill')!,
      },
      {
        ...snapshot.skills.find((skill) => skill.name === 'single-source-skill')!,
      },
    ],
    counts: {
      totalSkills: 9,
      driftedSkills: 4,
      healthySkills: 1,
      singleSourceSkills: 3,
      identicalDriftSkills: 4,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 1,
    },
  });
}

function createOperationalBaselineInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();

  return withSnapshotEntitySurfaces({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:09.000Z',
    sourceIds: snapshot.sourceIds.filter((sourceId) => sourceId !== 'sandbox-windsurf'),
    sources: snapshot.sources.filter((source) => source.id !== 'sandbox-windsurf'),
    skills: snapshot.skills.filter((skill) => skill.name !== 'single-source-skill'),
    counts: {
      totalSkills: 7,
      driftedSkills: 3,
      healthySkills: 2,
      singleSourceSkills: 1,
      identicalDriftSkills: 3,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 1,
    },
    agents: snapshot.agents?.map((agent) =>
      agent.id === 'sandbox-windsurf'
        ? {
            ...agent,
            installState: 'not-installed',
            skillsLocation: {
              state: 'available',
              exists: false,
              path: '~/.skillindex/sandbox/.codeium/windsurf/skills',
            },
            mcpConfigLocation: {
              state: 'unavailable',
              exists: false,
              reason: 'not-supported',
            },
          }
        : agent),
    homeSummary: {
      skills: {
        total: 7,
        healthy: 3,
        needsAttention: 4,
      },
      mcps: {
        total: 6,
        healthy: 4,
        needsAttention: 2,
      },
      installedAgents: 3,
    },
  });
}

function createAllHealthyInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();

  return withSnapshotEntitySurfaces({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:12.000Z',
    skills: snapshot.skills.map((skill) => ({
      ...skill,
      structuralState: 'healthy',
      isDrifted: false,
      driftPresentation: 'none',
      diff: undefined,
    })),
    counts: {
      totalSkills: snapshot.skills.length,
      driftedSkills: 0,
      healthySkills: snapshot.skills.length,
      singleSourceSkills: 0,
      identicalDriftSkills: 0,
      divergedDriftSkills: 0,
      dismissedDriftSkills: 0,
    },
    mcps: (snapshot.mcps ?? []).map((mcp) => ({
      ...mcp,
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
    })),
    mcpCounts: {
      totalMcps: (snapshot.mcps ?? []).length,
      attentionMcps: 0,
      healthyMcps: (snapshot.mcps ?? []).length,
      dismissedAttentionMcps: 0,
    },
    homeSummary: {
      skills: {
        total: snapshot.skills.length,
        healthy: snapshot.skills.length,
        needsAttention: 0,
      },
      mcps: {
        total: (snapshot.mcps ?? []).length,
        healthy: (snapshot.mcps ?? []).length,
        needsAttention: 0,
      },
      installedAgents: snapshot.agentCounts?.installedAgents ?? 3,
    },
  });
}

function createMcpOnlyAutoResolvableInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = structuredClone(representativeInventorySnapshot);
  snapshot.skills = snapshot.skills.map((skill) => ({
    ...skill,
    structuralState: 'healthy',
    isDrifted: false,
    driftPresentation: 'none',
    issueReasons: [],
    diff: undefined,
  }));
  snapshot.counts = {
    totalSkills: snapshot.skills.length,
    driftedSkills: 0,
    healthySkills: snapshot.skills.length,
    singleSourceSkills: 0,
    identicalDriftSkills: 0,
    divergedDriftSkills: 0,
    dismissedDriftSkills: 0,
  };
  snapshot.subagents = (snapshot.subagents ?? []).map((subagent) => ({
    ...subagent,
    status: 'healthy',
    presentation: 'none',
    issueReasons: [],
    missingLocations: [],
  }));
  snapshot.subagentCounts = {
    totalSubagents: snapshot.subagents.length,
    attentionSubagents: 0,
    healthySubagents: snapshot.subagents.length,
    dismissedAttentionSubagents: 0,
  };
  delete snapshot.homeSummary;
  snapshot.homeSummary = getHomeSummary(snapshot);

  return snapshot;
}

function createBatchAutoResolvableInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const templateSkill = snapshot.skills.find((skill) => skill.name === 'identical-drift-skill')!;
  const skills = ['batch-copy-a', 'batch-copy-b'].map((skillName, index) => ({
    ...templateSkill,
    name: skillName,
    locations: templateSkill.locations.map((location) => ({
      ...location,
      path: `${location.path}/${skillName}`,
      resolvedPath: `${location.resolvedPath ?? location.path}/${skillName}`,
      contentHash: `batch-${index}`,
    })),
  }));

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    skills,
    mcps: [],
    counts: {
      totalSkills: skills.length,
      driftedSkills: skills.length,
      healthySkills: 0,
      singleSourceSkills: 0,
      identicalDriftSkills: skills.length,
      divergedDriftSkills: 0,
      dismissedDriftSkills: 0,
    },
    mcpCounts: {
      totalMcps: 0,
      attentionMcps: 0,
      healthyMcps: 0,
      dismissedAttentionMcps: 0,
    },
    homeSummary: {
      skills: {
        total: skills.length,
        healthy: 0,
        needsAttention: skills.length,
      },
      mcps: {
        total: 0,
        healthy: 0,
        needsAttention: 0,
      },
      installedAgents: snapshot.agentCounts?.installedAgents ?? 3,
    },
  });
}

function createOperationalPromotedInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();

  return withSnapshotEntitySurfaces({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:11.000Z',
    agents: snapshot.agents?.map((agent) =>
      agent.id === 'sandbox-windsurf'
        ? {
            ...agent,
            installState: 'installed',
            skillsLocation: {
              state: 'available',
              exists: true,
              path: '~/.skillindex/sandbox/.codeium/windsurf/skills',
            },
            mcpConfigLocation: {
              state: 'unavailable',
              exists: false,
              reason: 'not-supported',
            },
          }
        : agent),
    homeSummary: {
      skills: {
        total: 8,
        healthy: 4,
        needsAttention: 4,
      },
      mcps: {
        total: 6,
        healthy: 4,
        needsAttention: 2,
      },
      installedAgents: 4,
    },
  });
}

function createVanishingSourceMutedInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const customSource = {
    id: 'custom:/tmp/skillindex/vanishing-source',
    label: 'Custom /tmp/skillindex/vanishing-source',
    canonical: false,
    kind: 'custom' as const,
    writable: true,
    scope: 'custom' as const,
    skillsDir: '/tmp/skillindex/vanishing-source',
  };

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:12.000Z',
    sourceIds: [...snapshot.sourceIds, customSource.id],
    sources: [...snapshot.sources, customSource],
    skills: [
      ...snapshot.skills,
      {
        name: 'vanishing-muted-skill',
        structuralState: 'identical-drift',
        isDrifted: true,
        driftPresentation: 'dismissed',
        driftSignature: JSON.stringify({
          name: 'vanishing-muted-skill',
          sourceId: customSource.id,
        }),
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            sourceId: 'sandbox-agents',
            sourceLabel: 'Sandbox .agents',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-08T00:00:00.000Z',
            canonical: true,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'vanish-a',
          },
          {
            path: '/tmp/skillindex/vanishing-source/vanishing-muted-skill.md',
            sourceId: customSource.id,
            sourceLabel: customSource.label,
            sourceScope: 'custom',
            fileType: 'real-file',
            modifiedAt: '2026-01-08T00:00:01.000Z',
            canonical: false,
            resolvedPath: '/tmp/skillindex/vanishing-source/vanishing-muted-skill.md',
            contentHash: 'vanish-a',
          },
        ],
      },
    ],
    counts: {
      totalSkills: 9,
      driftedSkills: 3,
      healthySkills: 2,
      singleSourceSkills: 2,
      identicalDriftSkills: 4,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 2,
    },
    homeSummary: {
      skills: {
        total: 9,
        healthy: 4,
        needsAttention: 5,
      },
      mcps: {
        total: 6,
        healthy: 4,
        needsAttention: 2,
      },
      installedAgents: 3,
    },
  });
}

function createVanishingSourceRemovedInventorySnapshot(): SkillInventorySnapshot {
  const snapshot = createVanishingSourceMutedInventorySnapshot();
  const customSourceId = 'custom:/tmp/skillindex/vanishing-source';
  const vanishingSkill = snapshot.skills.find((skill) => skill.name === 'vanishing-muted-skill')!;

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:13.000Z',
    sourceIds: snapshot.sourceIds.filter((sourceId) => sourceId !== customSourceId),
    sources: snapshot.sources.filter((source) => source.id !== customSourceId),
    skills: snapshot.skills
      .map((skill) => {
        if (skill.name !== 'vanishing-muted-skill') {
          return skill;
        }

        return {
          ...vanishingSkill,
          structuralState: 'healthy' as const,
          isDrifted: false,
          driftPresentation: 'none' as const,
          driftSignature: undefined,
          diff: undefined,
          locations: [vanishingSkill.locations[0]],
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    counts: {
      totalSkills: 9,
      driftedSkills: 3,
      healthySkills: 3,
      singleSourceSkills: 2,
      identicalDriftSkills: 3,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 1,
    },
    homeSummary: {
      skills: {
        total: 9,
        healthy: 5,
        needsAttention: 4,
      },
      mcps: {
        total: 6,
        healthy: 4,
        needsAttention: 2,
      },
      installedAgents: 3,
    },
  });
}

function createInventorySnapshotWithWatcherDriftChange(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const factorySource = snapshot.sources.find((source) => source.id === 'sandbox-factory')!;
  const healthySkill = snapshot.skills.find((skill) => skill.name === 'healthy-skill')!;

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:20.000Z',
    skills: snapshot.skills
      .map<SkillInventorySnapshot['skills'][number]>((skill) => {
        if (skill.name !== 'healthy-skill') {
          return skill;
        }

        return {
          ...healthySkill,
          structuralState: 'identical-drift',
          isDrifted: true,
          driftPresentation: 'active',
          driftSignature: JSON.stringify({
            name: 'healthy-skill',
            changedBy: 'watcher',
          }),
          locations: [
            healthySkill.locations[0],
            {
              path: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
              sourceId: factorySource.id,
              sourceLabel: factorySource.label,
              sourceScope: factorySource.scope,
              fileType: 'real-file',
              modifiedAt: '2026-01-08T00:00:00.000Z',
              canonical: false,
              resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
              contentHash: 'ccc',
            },
          ],
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
    counts: {
      totalSkills: 8,
      driftedSkills: 4,
      healthySkills: 1,
      singleSourceSkills: 2,
      identicalDriftSkills: 4,
      divergedDriftSkills: 1,
      dismissedDriftSkills: 1,
    },
  });
}

function createInventorySnapshotWithWatcherChangedDivergedCandidates(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();
  const factorySource = snapshot.sources.find((source) => source.id === 'sandbox-factory')!;
  const divergedSkill = snapshot.skills.find((skill) => skill.name === 'diverged-drift-skill')!;

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:21.000Z',
    skills: snapshot.skills
      .map<SkillInventorySnapshot['skills'][number]>((skill) => {
        if (skill.name !== 'diverged-drift-skill') {
          return skill;
        }

        return {
          ...divergedSkill,
          locations: [
            divergedSkill.locations[0],
            {
              path: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
              sourceId: factorySource.id,
              sourceLabel: factorySource.label,
              sourceScope: factorySource.scope,
              fileType: 'real-file',
              modifiedAt: '2026-01-04T00:00:03.000Z',
              canonical: false,
              resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
              contentHash: 'ccc',
            },
          ],
          diff: {
            primaryPath: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
            primarySourceLabel: factorySource.label,
            comparisons: [
              {
                path: divergedSkill.locations[0].path,
                sourceLabel: divergedSkill.locations[0].sourceLabel,
                lines: [
                  {
                    type: 'context',
                    text: '# Diverged drift skill',
                  },
                  {
                    type: 'removed',
                    text: 'Canonical candidate content.',
                  },
                  {
                    type: 'added',
                    text: 'Conflicting content from Factory.',
                  },
                ],
              },
            ],
          },
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })),
  });
}

function createInventorySnapshotWithDiagnosticRichSkill(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshot();

  return withSnapshotDetailDiagnostics({
    ...snapshot,
    scannedAt: '2026-04-09T00:00:15.000Z',
    skills: [
      ...snapshot.skills,
      {
        name: 'diagnostic-rich-skill',
        structuralState: 'diverged-drift',
        isDrifted: true,
        driftPresentation: 'active',
        locations: [
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            sourceId: 'sandbox-agents',
            sourceLabel: 'Sandbox .agents',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-08T00:00:00.000Z',
            canonical: true,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
            contentHash: 'diag-a',
          },
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
            sourceId: 'sandbox-claude',
            sourceLabel: 'Sandbox Claude',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-08T00:00:02.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
            contentHash: 'diag-b',
          },
          {
            path: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
            sourceId: 'sandbox-factory',
            sourceLabel: 'Sandbox Factory',
            sourceScope: 'sandbox',
            fileType: 'real-file',
            modifiedAt: '2026-01-08T00:00:01.000Z',
            canonical: false,
            resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
            contentHash: 'diag-c',
          },
        ],
        diff: {
          primaryPath: '/Users/arjitjaiswal/.skillindex/sandbox/.claude',
          primarySourceLabel: 'Sandbox Claude',
          comparisons: [
            {
              path: '/Users/arjitjaiswal/.skillindex/sandbox/.agents',
              sourceLabel: 'Sandbox .agents',
              lines: [
                { type: 'context', text: '---' },
                { type: 'context', text: 'name: diagnostic-rich-skill' },
                { type: 'removed', text: 'description: Canonical detail candidate.' },
                { type: 'added', text: 'description: Claude detail candidate.' },
                { type: 'context', text: '---' },
                { type: 'context', text: '# Diagnostic rich skill' },
                { type: 'removed', text: 'Canonical content.' },
                { type: 'added', text: 'Claude copy with its own description.' },
              ],
            },
            {
              path: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
              sourceLabel: 'Sandbox Factory',
              lines: [
                { type: 'context', text: '---' },
                { type: 'removed', text: 'description: Factory copy with a description but missing a name field.' },
                { type: 'added', text: 'name: diagnostic-rich-skill' },
                { type: 'added', text: 'description: Claude detail candidate.' },
                { type: 'context', text: '---' },
                { type: 'context', text: '# Diagnostic rich skill' },
                { type: 'removed', text: 'Factory copy missing the required name.' },
                { type: 'added', text: 'Claude copy with its own description.' },
              ],
            },
          ],
        },
      },
    ],
    counts: {
      totalSkills: 9,
      driftedSkills: 4,
      healthySkills: 2,
      singleSourceSkills: 2,
      identicalDriftSkills: 3,
      divergedDriftSkills: 2,
      dismissedDriftSkills: 1,
    },
  });
}

function createInventorySnapshotWithUpdatedDiagnosticRichSkill(): SkillInventorySnapshot {
  const snapshot = createInventorySnapshotWithDiagnosticRichSkill();
  const windsurfLocation = {
    path: '/Users/arjitjaiswal/.skillindex/sandbox/.codeium/windsurf',
    sourceId: 'sandbox-windsurf',
    sourceLabel: 'Sandbox Windsurf',
    sourceScope: 'sandbox' as const,
    fileType: 'real-file' as const,
    modifiedAt: '2026-01-08T00:00:03.000Z',
    canonical: false,
    resolvedPath: '/Users/arjitjaiswal/.skillindex/sandbox/.codeium/windsurf',
    contentHash: 'diag-d',
  };

  return {
    ...snapshot,
    scannedAt: '2026-04-09T00:00:25.000Z',
    skills: snapshot.skills.map((skill) => {
      if (skill.name !== 'diagnostic-rich-skill') {
        return skill;
      }

      const locations = [...skill.locations, windsurfLocation];

      return {
        ...skill,
        locations,
        detailDiagnostics: {
          duplicateCandidates: [
            ...skill.detailDiagnostics.duplicateCandidates,
            {
              ...windsurfLocation,
              installSource: {
                sourceId: 'sandbox-windsurf',
                label: 'Sandbox Windsurf',
                kind: 'agent',
                scope: 'sandbox',
                writable: true,
                canonical: false,
              },
            },
          ],
          installSources: [
            ...skill.detailDiagnostics.installSources,
            {
              sourceId: 'sandbox-windsurf',
              label: 'Sandbox Windsurf',
              kind: 'agent',
              scope: 'sandbox',
              writable: true,
              canonical: false,
            },
          ],
          missingInstallSources: skill.detailDiagnostics.missingInstallSources ?? [],
          definitionIssues: (skill.detailDiagnostics.definitionIssues ?? []).filter((issue) => issue.field !== 'description'),
        },
      };
    }),
  };
}

function createRepresentativeBrokenSymlinkSkillSnapshot(): SkillInventorySnapshot {
  const snapshot = structuredClone(representativeInventorySnapshot);

  snapshot.skills = snapshot.skills.map((skill) => {
    if (skill.name !== 'missing-symlink-skill') {
      return skill;
    }

    return {
      ...skill,
      name: 'broken-symlink-skill',
      issueReasons: ['broken-symlink'],
      detailDiagnostics: {
        ...skill.detailDiagnostics,
        missingInstallSources: [],
      },
      locations: [
        skill.locations[0],
        {
          ...skill.locations[1],
          path: '~/.skillindex/sandbox/.claude/skills/broken-symlink-skill.md',
          resolvedPath: undefined,
          symlinkTarget: undefined,
        },
      ],
    };
  });

  return snapshot;
}

function createRepresentativeWrongSymlinkTargetSkillSnapshot(): SkillInventorySnapshot {
  const snapshot = structuredClone(representativeInventorySnapshot);

  snapshot.skills = snapshot.skills.map((skill) => {
    if (skill.name !== 'missing-symlink-skill') {
      return skill;
    }

    return {
      ...skill,
      name: 'wrong-symlink-target-skill',
      issueReasons: ['wrong-symlink-target'],
      detailDiagnostics: {
        ...skill.detailDiagnostics,
        missingInstallSources: [],
      },
      locations: [
        skill.locations[0],
        {
          ...skill.locations[1],
          path: '~/.skillindex/sandbox/.claude/skills/wrong-symlink-target-skill.md',
          resolvedPath: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
          symlinkTarget: '~/.skillindex/sandbox/.agents/skills/healthy-skill.md',
        },
      ],
    };
  });

  return snapshot;
}

type SkillRecordWithoutDetailDiagnostics = Omit<SkillInventorySnapshot['skills'][number], 'detailDiagnostics'>;
type SnapshotWithoutDetailDiagnostics = Omit<SkillInventorySnapshot, 'skills'> & {
  skills: SkillRecordWithoutDetailDiagnostics[];
};

const REPRESENTATIVE_SKILL_DESCRIPTIONS: Record<string, string> = {
  'diagnostic-rich-skill': 'Canonical detail candidate.',
  'diverged-drift-skill': 'Canonical candidate content.',
  'dismissed-drift-skill': 'Shared copy currently hidden from review.',
  'healthy-skill': 'Healthy across every installed location.',
  'identical-drift-skill': 'Two file copies currently match exactly.',
  'mixed-plugin-skill': 'Plugin-managed copy with an extra installed file.',
  'plugin-readonly-skill': 'Read-only plugin skill outside the universal .agents folder.',
  'single-source-skill': 'Installed in a single location outside the universal .agents folder.',
  'MiXeD-Case-Skill': 'Case-sensitive install that still resolves cleanly.',
  'custom-only-skill': 'Loaded only from a custom scan path.',
};

function withSnapshotDetailDiagnostics(snapshot: SnapshotWithoutDetailDiagnostics): SkillInventorySnapshot {
  const sourceIndex = new Map(snapshot.sources.map((source) => [source.id, source]));

  return withSnapshotEntitySurfaces({
    ...snapshot,
    skills: snapshot.skills.map((skill) => ({
      ...skill,
      issueReasons: skill.issueReasons ?? deriveSkillIssueReasons(skill.structuralState),
      description: skill.description ?? REPRESENTATIVE_SKILL_DESCRIPTIONS[skill.name] ?? null,
      detailDiagnostics: {
        duplicateCandidates: skill.locations.length > 1
          ? skill.locations.map((location) => ({
            ...location,
            installSource: createInstallSource(location, sourceIndex),
          }))
          : [],
        installSources: dedupeInstallSources(skill.locations, sourceIndex),
        missingInstallSources: [],
        definitionIssues: skill.name === 'diagnostic-rich-skill'
          ? [
            {
              type: 'missing-required-field' as const,
              field: 'name' as const,
              path: '/Users/arjitjaiswal/.skillindex/sandbox/.factory',
              sourceId: 'sandbox-factory',
              sourceLabel: 'Sandbox Factory',
              sourceScope: 'sandbox' as const,
              installSource: createInstallSource(skill.locations[2], sourceIndex),
            },
          ]
          : [],
      },
    })),
  });
}

function dedupeInstallSources(
  locations: SkillInventorySnapshot['skills'][number]['locations'],
  sourceIndex: Map<string, SkillInventorySnapshot['sources'][number]>,
) {
  const installSources = new Map<string, ReturnType<typeof createInstallSource>>();

  for (const location of locations) {
    if (!installSources.has(location.sourceId)) {
      installSources.set(location.sourceId, createInstallSource(location, sourceIndex));
    }
  }

  return [...installSources.values()];
}

function createInstallSource(
  location: SkillInventorySnapshot['skills'][number]['locations'][number],
  sourceIndex: Map<string, SkillInventorySnapshot['sources'][number]>,
) {
  const source = sourceIndex.get(location.sourceId);

  return {
    sourceId: location.sourceId,
    label: location.sourceLabel,
    kind: source?.kind ?? 'custom',
    scope: location.sourceScope,
    writable: source?.writable ?? false,
    canonical: location.canonical,
  };
}

function withSnapshotEntitySurfaces(snapshot: SkillInventorySnapshot): SkillInventorySnapshot {
  const mcps = snapshot.mcps ?? [
    {
      name: 'broken-mcp',
      status: 'needs-attention',
      presentation: 'active',
      issueReasons: ['definition-mismatch', 'invalid-definition'],
      signature: 'broken-mcp-signature',
      expectedLocations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
        },
      ],
      missingLocations: [],
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          args: ['missing-command.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "broken-mcp": {',
            '      "args": ["missing-command.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
          invalidDetails: ['Missing connection target.'],
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          command: 'node',
          args: ['recovered-command.js'],
          definitionText: [
            '{',
            '  "mcpServers": {',
            '    "broken-mcp": {',
            '      "command": "node",',
            '      "args": ["recovered-command.js"]',
            '    }',
            '  }',
            '}',
          ].join('\n'),
        },
      ],
    },
    {
      name: 'muted-mcp',
      status: 'needs-attention',
      presentation: 'dismissed',
      issueReasons: ['definition-mismatch'],
      signature: 'muted-mcp-signature',
      expectedLocations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
        },
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
        },
      ],
      missingLocations: [],
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          command: 'node',
          args: ['muted-server-v1.js'],
        },
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
          command: 'node',
          args: ['muted-server-v2.js'],
        },
      ],
    },
    {
      name: 'claude-only-mcp',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      expectedLocations: [
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
        },
      ],
      missingLocations: [],
      locations: [
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          command: 'node',
          args: ['claude-only-server.js'],
        },
      ],
    },
    {
      name: 'codex-only-mcp',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      expectedLocations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
        },
      ],
      missingLocations: [],
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          command: 'node',
          args: ['codex-only-server.js'],
        },
      ],
    },
    {
      name: 'factory-only-mcp',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      expectedLocations: [
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
        },
      ],
      missingLocations: [],
      locations: [
        {
          agentId: 'sandbox-factory',
          agentLabel: 'Sandbox Factory',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.factory/mcp.json',
          command: 'node',
          args: ['factory-only-server.js'],
        },
      ],
    },
    {
      name: 'healthy-mcp',
      status: 'healthy',
      presentation: 'none',
      issueReasons: [],
      expectedLocations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
        },
      ],
      missingLocations: [],
      locations: [
        {
          agentId: 'sandbox-agents',
          agentLabel: 'Sandbox .agents',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.agents/mcp.json',
          command: 'node',
          args: ['healthy-server.js'],
        },
        {
          agentId: 'sandbox-claude',
          agentLabel: 'Sandbox Claude',
          scope: 'sandbox',
          configPath: '~/.skillindex/sandbox/.claude.json',
          command: 'node',
          args: ['healthy-server.js'],
        },
      ],
    },
  ];

  const mcpCounts = snapshot.mcpCounts ?? {
    totalMcps: mcps.length,
    attentionMcps: mcps.filter((mcp) => mcp.status === 'needs-attention' && mcp.presentation === 'active').length,
    healthyMcps: mcps.filter((mcp) => mcp.status === 'healthy').length,
    dismissedAttentionMcps: mcps.filter((mcp) => mcp.status === 'needs-attention' && mcp.presentation === 'dismissed').length,
  };

  const agents = snapshot.agents ?? buildMockAgents('~/.skillindex/sandbox');

  const agentCounts = snapshot.agentCounts ?? {
    totalAgents: agents.length,
    installedAgents: agents.filter((agent) => agent.installState === 'installed').length,
    notInstalledAgents: agents.filter((agent) => agent.installState === 'not-installed').length,
  };

  const homeSummary = snapshot.homeSummary ?? {
    skills: {
      total: snapshot.counts.totalSkills,
      healthy: snapshot.counts.healthySkills,
      needsAttention: snapshot.counts.driftedSkills + snapshot.counts.dismissedDriftSkills,
    },
    mcps: {
      total: mcpCounts.totalMcps,
      healthy: mcpCounts.healthyMcps,
      needsAttention: mcpCounts.attentionMcps + mcpCounts.dismissedAttentionMcps,
    },
    installedAgents: agentCounts.installedAgents,
  };

  return {
    ...snapshot,
    mcps,
    mcpCounts,
    agents,
    agentCounts,
    homeSummary,
  };
}

function deriveSkillIssueReasons(
  structuralState: SkillInventorySnapshot['skills'][number]['structuralState'],
): SkillIssueReason[] {
  switch (structuralState) {
    case 'healthy':
      return [];
    case 'missing-symlinks':
      return ['missing-symlinks'];
    case 'single-source-noncanonical':
      return ['missing-canonical'];
    case 'identical-drift':
      return ['identical-copies'];
    case 'diverged-drift':
      return ['diverged-copies'];
  }
}

function buildMockAgents(rootDir: string, options: { windsurfInstalled?: boolean } = {}): AgentRecord[] {
  return AGENT_CATALOG.map((family) => {
    const id = `sandbox-${family.family}`;
    const installState: AgentRecord['installState'] =
      family.family === 'codex'
      || family.family === 'claude'
      || family.family === 'claude-desktop'
      || family.family === 'factory'
      || (family.family === 'windsurf' && options.windsurfInstalled)
        ? 'installed'
        : 'not-installed';

    return {
      id,
      family: family.family,
      label: family.label,
      writable: true,
      scope: 'sandbox' as const,
      installState,
      defaultProjectSkillsDir: family.defaultProjectSkillsDir,
      defaultGlobalSkillsDir: family.defaultGlobalSkillsDir,
      defaultHomeDir: family.skillStorageKind === 'local-directory'
        ? deriveAgentDefaultHomeDir(family.defaultProjectSkillsDir, family.defaultGlobalSkillsDir)
        : '',
      mcpConfigKind: family.mcpConfigKind,
      mcpParserKind: family.mcpParserKind,
      metadataSources: family.metadataSources,
      icon: family.icon,
      skillsLocation: family.skillStorageKind === 'local-directory'
        ? {
            state: 'available' as const,
            exists: installState === 'installed',
            path: resolveAgentHomeRelativePath(rootDir, family.defaultGlobalSkillsDir),
          }
        : {
            state: 'unavailable' as const,
            exists: false,
            reason: 'account-managed' as const,
          },
      mcpConfigLocation: family.mcpConfigRelativeParts
        ? {
            state: 'available' as const,
            exists: installState === 'installed',
            path: joinMockPath(rootDir, ...family.mcpConfigRelativeParts),
          }
        : {
            state: 'unavailable' as const,
            exists: false,
            reason: 'not-supported' as const,
          },
      configLocation: family.agentConfigRelativeParts
        ? {
            state: 'available' as const,
            exists: installState === 'installed',
            path: joinMockPath(rootDir, ...family.agentConfigRelativeParts),
          }
        : {
            state: 'unavailable' as const,
            exists: false,
            reason: 'not-supported' as const,
          },
      executableLocation: family.expectedExecutableNames?.[0]
        ? {
            state: 'available' as const,
            exists: installState === 'installed',
            path: joinMockPath(rootDir, 'bin', family.expectedExecutableNames[0]),
          }
        : {
            state: 'unavailable' as const,
            exists: false,
            reason: 'not-supported' as const,
          },
    };
  });
}

function joinMockPath(rootDir: string, ...parts: string[]) {
  return [rootDir.replace(/\/+$/, ''), ...parts].join('/');
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}
