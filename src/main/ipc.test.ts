import { mkdtemp, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  IPC_CHANNELS,
  type AuditOperation,
  type CompleteOnboardingRequest,
  type RescanInventoryRequest,
  type SeedRepresentativeFixturesResult,
  type SettingsState,
  type SkillInventorySnapshot,
  type UndoAuditOperationResult,
} from '@shared/contracts';
import { createInventoryRuntime } from '@main/inventory-runtime';
import { getInventoryMode, setInventoryMode } from '@main/inventory-mode-session';
import { completeOnboarding, setDevSidebarInventorySourceSwitcherVisible } from '@main/settings-state';
import { seedRepresentativeFixtures } from '@main/sandbox-fixtures';
import { resolveSkillIndexPaths } from '@shared/skill-index-paths';

import { registerIpcHandlers } from './ipc';

const { inventoryRuntime } = vi.hoisted(() => ({
  inventoryRuntime: {
    onDidUpdate: vi.fn(),
    readCachedInventory: vi.fn(),
    scanInventory: vi.fn(),
    rescanInventory: vi.fn(),
    testMcpConnectivity: vi.fn(),
    cancelMcpConnectivityTest: vi.fn(),
    addSkill: vi.fn(),
    addMcpServer: vi.fn(),
    addSubagent: vi.fn(),
    resolveIssue: vi.fn(),
    applyCapabilityAction: vi.fn(),
    dismissDrift: vi.fn(),
    readAuditLog: vi.fn(),
    undoAuditOperation: vi.fn(),
    releaseStartupObservation: vi.fn(),
    onDidAuditUpdate: vi.fn(),
  },
}));

const { electronMocks } = vi.hoisted(() => ({
  electronMocks: {
    ipcHandle: vi.fn(),
    ipcOn: vi.fn(),
    ipcRemoveHandler: vi.fn(),
    ipcRemoveAllListeners: vi.fn(),
    showOpenDialog: vi.fn(),
    shellOpenPath: vi.fn(),
    shellShowItemInFolder: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
  ipcMain: {
    removeHandler: electronMocks.ipcRemoveHandler,
    removeAllListeners: electronMocks.ipcRemoveAllListeners,
    handle: electronMocks.ipcHandle,
    on: electronMocks.ipcOn,
  },
  shell: {
    openPath: electronMocks.shellOpenPath,
    showItemInFolder: electronMocks.shellShowItemInFolder,
  },
}));

vi.mock('@main/app-shell', () => ({
  getAppShellState: vi.fn(),
}));

vi.mock('@main/auto-update', () => ({
  getAutoUpdateStatus: vi.fn(() => ({ phase: 'disabled' })),
  installReadyAutoUpdate: vi.fn(() => ({ phase: 'disabled' })),
  requestAutoUpdateCheck: vi.fn(() => Promise.resolve({ phase: 'disabled' })),
}));

vi.mock('@main/inventory-runtime', () => ({
  createInventoryRuntime: vi.fn(() => inventoryRuntime),
}));

vi.mock('@main/settings-state', () => ({
  addCustomScanPath: vi.fn(),
  clearPreferredCanonicalSourcePath: vi.fn(),
  completeOnboarding: vi.fn(),
  readSettingsState: vi.fn(),
  removeCustomScanPath: vi.fn(),
  setDevSidebarInventorySourceSwitcherVisible: vi.fn(),
  setPreferredCanonicalSourcePath: vi.fn(),
}));

vi.mock('@main/sandbox-fixtures', () => ({
  seedRepresentativeFixtures: vi.fn(),
}));

vi.mock('@main/scan-inventory', () => ({
  readCachedInventorySync: vi.fn(),
}));

describe('registerIpcHandlers', () => {
  it('enables MCP connectivity verification for app-driven full scans', () => {
    expect(createInventoryRuntime).toHaveBeenCalledWith({
      verifyMcpConnectivityOnFullScan: true,
    });
  });

  it('expands home-relative paths before passing them to Electron', async () => {
    electronMocks.ipcHandle.mockClear();
    electronMocks.shellOpenPath.mockResolvedValue('');
    electronMocks.shellShowItemInFolder.mockClear();

    registerIpcHandlers();

    const openPathHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.openPathInEditor,
    )?.[1] as ((event: never, targetPath: string) => Promise<void> | void) | undefined;

    expect(openPathHandler).toBeTypeOf('function');

    if (!openPathHandler) {
      throw new Error('Expected the open-path IPC handler to be registered.');
    }

    await openPathHandler({} as never, '~/.skillindex/sandbox/.agents/mcp.json');

    expect(electronMocks.shellOpenPath).toHaveBeenCalledWith(path.join(homedir(), '.skillindex', 'sandbox', '.agents', 'mcp.json'));

    const revealPathHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.revealPathInFinder,
    )?.[1] as ((event: never, targetPath: string) => Promise<void> | void) | undefined;

    expect(revealPathHandler).toBeTypeOf('function');

    if (!revealPathHandler) {
      throw new Error('Expected the reveal-path IPC handler to be registered.');
    }

    await revealPathHandler({} as never, '~/.codex/plugins/github');

    expect(electronMocks.shellShowItemInFolder).toHaveBeenCalledWith(path.join(homedir(), '.codex', 'plugins', 'github'));
  });

  it('passes the process environment to the development sandbox reset handler', async () => {
    electronMocks.ipcHandle.mockClear();
    const seedRepresentativeFixturesMock = vi.mocked(seedRepresentativeFixtures);
    seedRepresentativeFixturesMock.mockResolvedValue({
      fixtureSet: 'representative-agent-scan-foundation',
      sandboxRoot: '/tmp/skillindex-sandbox',
      ignoredPaths: [],
      skills: [],
    });
    const originalDevTools = process.env.SKILL_INDEX_ENABLE_DEV_TOOLS;
    const originalParserMatrix = process.env.SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX;
    process.env.SKILL_INDEX_ENABLE_DEV_TOOLS = '1';
    process.env.SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX = '1';

    try {
      registerIpcHandlers();

      const seedHandler = electronMocks.ipcHandle.mock.calls.find(
        ([channel]) => channel === IPC_CHANNELS.seedRepresentativeFixtures,
      )?.[1] as (() => Promise<SeedRepresentativeFixturesResult>) | undefined;

      expect(seedHandler).toBeTypeOf('function');

      if (!seedHandler) {
        throw new Error('Expected the seed representative fixtures IPC handler to be registered.');
      }

      await seedHandler();

      const [seedOptions] = seedRepresentativeFixturesMock.mock.calls.at(-1) ?? [];
      expect(seedOptions?.env).toBe(process.env);
      expect(seedOptions?.env?.SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX).toBe('1');
    } finally {
      if (originalDevTools === undefined) {
        delete process.env.SKILL_INDEX_ENABLE_DEV_TOOLS;
      } else {
        process.env.SKILL_INDEX_ENABLE_DEV_TOOLS = originalDevTools;
      }

      if (originalParserMatrix === undefined) {
        delete process.env.SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX;
      } else {
        process.env.SKILL_INDEX_SANDBOX_MCP_PARSER_MATRIX = originalParserMatrix;
      }
    }
  });

  it('returns the selected directory from the choose directory handler', async () => {
    electronMocks.ipcHandle.mockClear();
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/skillindex/repos/arjit-skills'],
    });

    registerIpcHandlers();

    const chooseDirectoryHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.chooseDirectory,
    )?.[1] as ((_event: never, request?: { title?: string }) => Promise<string | null>) | undefined;

    expect(chooseDirectoryHandler).toBeTypeOf('function');

    if (!chooseDirectoryHandler) {
      throw new Error('Expected the choose directory IPC handler to be registered.');
    }

    await expect(chooseDirectoryHandler({} as never, { title: 'Choose a preferred skills source' })).resolves.toBe(
      '/tmp/skillindex/repos/arjit-skills',
    );
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
      title: 'Choose a preferred skills source',
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('returns null from the choose directory handler when selection is canceled', async () => {
    electronMocks.ipcHandle.mockClear();
    electronMocks.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });

    registerIpcHandlers();

    const chooseDirectoryHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.chooseDirectory,
    )?.[1] as ((_event: never, request?: { title?: string }) => Promise<string | null>) | undefined;

    expect(chooseDirectoryHandler).toBeTypeOf('function');

    if (!chooseDirectoryHandler) {
      throw new Error('Expected the choose directory IPC handler to be registered.');
    }

    await expect(chooseDirectoryHandler({} as never)).resolves.toBeNull();
    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
      title: 'Choose directory',
      properties: ['openDirectory', 'createDirectory'],
    });
  });

  it('passes onboarding completion requests through the complete onboarding handler', async () => {
    electronMocks.ipcHandle.mockClear();
    const completeOnboardingMock = vi.mocked(completeOnboarding);
    completeOnboardingMock.mockResolvedValue({
      customScanPaths: ['/tmp/skillindex/repos/arjit-skills'],
      onboardingCompletedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
      showDevSidebarInventorySourceSwitcher: true,
    });

    registerIpcHandlers();

    const completeOnboardingHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.completeOnboarding,
    )?.[1] as ((_event: never, request?: CompleteOnboardingRequest) => Promise<SettingsState>) | undefined;

    expect(completeOnboardingHandler).toBeTypeOf('function');

    if (!completeOnboardingHandler) {
      throw new Error('Expected the complete onboarding IPC handler to be registered.');
    }

    await expect(completeOnboardingHandler({} as never, {
      completedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
    })).resolves.toEqual({
      customScanPaths: ['/tmp/skillindex/repos/arjit-skills'],
      onboardingCompletedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
      showDevSidebarInventorySourceSwitcher: true,
    });
    expect(completeOnboardingMock).toHaveBeenLastCalledWith({
      completedAt: '2026-05-19T06:30:00.000Z',
      preferredCanonicalSourcePath: '/tmp/skillindex/repos/arjit-skills',
    }, expect.objectContaining({}));

    completeOnboardingMock.mockResolvedValue({
      customScanPaths: [],
      onboardingCompletedAt: '2026-05-19T06:31:00.000Z',
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: true,
    });
    await completeOnboardingHandler({} as never);

    expect(completeOnboardingMock).toHaveBeenLastCalledWith({}, expect.objectContaining({}));
  });

  it('registers audit log read and undo handlers through the inventory runtime', async () => {
    electronMocks.ipcHandle.mockClear();
    inventoryRuntime.readAuditLog.mockResolvedValue([]);
    inventoryRuntime.undoAuditOperation.mockResolvedValue({
      auditLog: [],
      inventorySnapshot: null,
    });

    registerIpcHandlers();

    const readAuditHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.readAuditLog,
    )?.[1] as ((_event: never, options?: { limit?: number }) => Promise<AuditOperation[]>) | undefined;
    const undoAuditHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.undoAuditOperation,
    )?.[1] as ((_event: never, operationId: string) => Promise<UndoAuditOperationResult>) | undefined;

    expect(readAuditHandler).toBeTypeOf('function');
    expect(undoAuditHandler).toBeTypeOf('function');

    if (!readAuditHandler || !undoAuditHandler) {
      throw new Error('Expected audit IPC handlers to be registered.');
    }

    await expect(readAuditHandler({} as never, { limit: 20 })).resolves.toEqual([]);
    await expect(undoAuditHandler({} as never, 'operation-1')).resolves.toEqual({
      auditLog: [],
      inventorySnapshot: null,
    });

    expect(inventoryRuntime.readAuditLog).toHaveBeenCalledWith(
      { limit: 20 },
      expect.objectContaining({
        includeLiveSources: true,
        includeSandboxSources: false,
      }),
    );
    expect(inventoryRuntime.undoAuditOperation).toHaveBeenCalledWith('operation-1');
  });

  it('records global settings audit entries as live when sandbox mode is active', async () => {
    electronMocks.ipcHandle.mockClear();
    const setSwitcherVisibleMock = vi.mocked(setDevSidebarInventorySourceSwitcherVisible);
    setSwitcherVisibleMock.mockClear();
    setSwitcherVisibleMock.mockResolvedValueOnce({
      customScanPaths: [],
      onboardingCompletedAt: null,
      preferredCanonicalSourcePath: null,
      showDevSidebarInventorySourceSwitcher: false,
    });
    const originalDataDir = process.env.SKILL_INDEX_DATA_DIR;
    const originalMode = getInventoryMode();
    const root = await mkdtemp(path.join(tmpdir(), 'skillindex-ipc-global-audit-'));

    try {
      process.env.SKILL_INDEX_DATA_DIR = root;
      setInventoryMode('sandbox');
      registerIpcHandlers();

      const setSwitcherHandler = electronMocks.ipcHandle.mock.calls.find(
        ([channel]) => channel === IPC_CHANNELS.setDevSidebarInventorySourceSwitcherVisible,
      )?.[1] as ((_event: never, visible: boolean) => Promise<SettingsState>) | undefined;

      expect(setSwitcherHandler).toBeTypeOf('function');

      if (!setSwitcherHandler) {
        throw new Error('Expected the dev sidebar source switcher IPC handler to be registered.');
      }

      await expect(setSwitcherHandler({} as never, false)).resolves.toEqual({
        customScanPaths: [],
        onboardingCompletedAt: null,
        preferredCanonicalSourcePath: null,
        showDevSidebarInventorySourceSwitcher: false,
      });

      const [visible, scanOptions] = setSwitcherVisibleMock.mock.calls.at(-1) ?? [];
      expect(visible).toBe(false);
      expect(scanOptions).toEqual(expect.objectContaining({
        includeSandboxSources: true,
        includeLiveSources: false,
      }));

      const paths = resolveSkillIndexPaths({ env: process.env });
      const records = (await readFile(paths.auditLogFile, 'utf8'))
        .trim()
        .split('\n')
        .map((line): unknown => JSON.parse(line) as unknown);
      const startedRecord = records.find(isOperationStartedAuditRecord);
      expect(startedRecord?.operation).toEqual(expect.objectContaining({
        sourceMode: 'live',
        title: 'Hide sidebar inventory source switcher',
      }));
    } finally {
      setInventoryMode(originalMode);
      if (originalDataDir === undefined) {
        delete process.env.SKILL_INDEX_DATA_DIR;
      } else {
        process.env.SKILL_INDEX_DATA_DIR = originalDataDir;
      }
    }
  });

  it('lets app-driven refreshes opt out of MCP connectivity verification', async () => {
    electronMocks.ipcHandle.mockClear();
    inventoryRuntime.rescanInventory.mockResolvedValue({});

    registerIpcHandlers();

    const rescanHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.rescanInventory,
    )?.[1] as ((event: never, request?: RescanInventoryRequest) => Promise<SkillInventorySnapshot>) | undefined;

    expect(rescanHandler).toBeTypeOf('function');

    if (!rescanHandler) {
      throw new Error('Expected the rescan IPC handler to be registered.');
    }

    await rescanHandler({} as never, { verifyMcpConnectivity: false });

    expect(inventoryRuntime.rescanInventory).toHaveBeenCalledWith(
      expect.objectContaining({ verifyMcpConnectivity: false }),
    );
  });

  it('registers a standalone MCP connectivity test handler', async () => {
    electronMocks.ipcHandle.mockClear();
    inventoryRuntime.testMcpConnectivity.mockResolvedValue({});

    registerIpcHandlers();

    const testConnectivityHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.testMcpConnectivity,
    )?.[1] as (() => Promise<SkillInventorySnapshot>) | undefined;

    expect(testConnectivityHandler).toBeTypeOf('function');

    if (!testConnectivityHandler) {
      throw new Error('Expected the MCP connectivity IPC handler to be registered.');
    }

    await testConnectivityHandler();

    expect(inventoryRuntime.testMcpConnectivity).toHaveBeenCalledWith(expect.objectContaining({}));
  });

  it('registers a standalone MCP connectivity cancellation handler', () => {
    electronMocks.ipcHandle.mockClear();
    inventoryRuntime.cancelMcpConnectivityTest.mockClear();

    registerIpcHandlers();

    const cancelConnectivityHandler = electronMocks.ipcHandle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.cancelMcpConnectivityTest,
    )?.[1] as (() => void) | undefined;

    expect(cancelConnectivityHandler).toBeTypeOf('function');

    if (!cancelConnectivityHandler) {
      throw new Error('Expected the MCP connectivity cancellation IPC handler to be registered.');
    }

    cancelConnectivityHandler();

    expect(inventoryRuntime.cancelMcpConnectivityTest).toHaveBeenCalledTimes(1);
  });
});

function isOperationStartedAuditRecord(value: unknown): value is {
  operation: {
    sourceMode?: string;
    title?: string;
  };
} {
  return isRecord(value)
    && value.recordKind === 'operation-started'
    && isRecord(value.operation);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
