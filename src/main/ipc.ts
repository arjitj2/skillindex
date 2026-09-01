import os from 'node:os';
import path from 'node:path';

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';

import {
  type AddMcpServerRequest,
  type AddSkillRequest,
  type AddSubagentRequest,
  type AuditOperation,
  type CapabilityActionRequest,
  type ChooseDirectoryRequest,
  type CompleteOnboardingRequest,
  type DismissDriftRequest,
  IPC_CHANNELS,
  type RemoveInventoryItemRequest,
  type RescanInventoryRequest,
  type ResolveIssueRequest,
  type InventorySourceMode,
} from '@shared/contracts';
import { serializeIpcError } from '@shared/ipc-error';
import { createAuditLogService, type AuditOperationRequest } from '@main/audit-log';
import { getAutoUpdateStatus, installReadyAutoUpdate, requestAutoUpdateCheck } from '@main/auto-update';
import { getAppShellState } from '@main/app-shell';
import { createInventoryRuntime } from '@main/inventory-runtime';
import {
  addCustomScanPath,
  clearPreferredCanonicalSourcePath,
  completeOnboarding,
  readSettingsState,
  removeCustomScanPath,
  setDevSidebarInventorySourceSwitcherVisible,
  setPreferredCanonicalSourcePath,
} from '@main/settings-state';
import { readCachedInventorySync } from '@main/scan-inventory';
import { isDevToolsEnabled } from '@main/dev-tools';
import { resolveInventoryScanOptions, setInventoryMode } from '@main/inventory-mode-session';
import {
  resolveSandboxSkillIndexPaths,
  resolveSkillIndexPaths,
  resolveSkillIndexPathsForScanOptions,
  type SkillIndexPaths,
} from '@shared/skill-index-paths';

const inventoryRuntime = createInventoryRuntime({
  verifyMcpConnectivityOnFullScan: true,
});
let hasRegisteredInventoryBroadcast = false;
let hasRegisteredAuditBroadcast = false;
const ipcAuditServicesByLogFile = new Map<string, ReturnType<typeof createAuditLogService>>();

export function triggerInventoryRescan(request: RescanInventoryRequest = {}) {
  return inventoryRuntime.rescanInventory({
    ...resolveInventoryScanOptions(),
    ...request,
  });
}

export function registerIpcHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.getShellState);
  ipcMain.removeHandler(IPC_CHANNELS.readUpdateStatus);
  ipcMain.removeHandler(IPC_CHANNELS.checkForUpdates);
  ipcMain.removeHandler(IPC_CHANNELS.installUpdate);
  ipcMain.removeHandler(IPC_CHANNELS.openPathInEditor);
  ipcMain.removeHandler(IPC_CHANNELS.revealPathInFinder);
  ipcMain.removeHandler(IPC_CHANNELS.chooseDirectory);
  ipcMain.removeAllListeners(IPC_CHANNELS.readInitialInventoryBootstrap);
  ipcMain.removeHandler(IPC_CHANNELS.readCachedInventory);
  ipcMain.removeHandler(IPC_CHANNELS.scanInventory);
  ipcMain.removeHandler(IPC_CHANNELS.rescanInventory);
  ipcMain.removeHandler(IPC_CHANNELS.testMcpConnectivity);
  ipcMain.removeHandler(IPC_CHANNELS.cancelMcpConnectivityTest);
  ipcMain.removeHandler(IPC_CHANNELS.addSkill);
  ipcMain.removeHandler(IPC_CHANNELS.addMcpServer);
  ipcMain.removeHandler(IPC_CHANNELS.addSubagent);
  ipcMain.removeHandler(IPC_CHANNELS.resolveIssue);
  ipcMain.removeHandler(IPC_CHANNELS.applyCapabilityAction);
  ipcMain.removeHandler(IPC_CHANNELS.dismissDrift);
  ipcMain.removeHandler(IPC_CHANNELS.removeInventoryItem);
  ipcMain.removeHandler(IPC_CHANNELS.readAuditLog);
  ipcMain.removeHandler(IPC_CHANNELS.undoAuditOperation);
  ipcMain.removeHandler(IPC_CHANNELS.releaseStartupObservation);
  ipcMain.removeHandler(IPC_CHANNELS.seedRepresentativeFixtures);
  ipcMain.removeHandler(IPC_CHANNELS.setInventoryMode);
  ipcMain.removeHandler(IPC_CHANNELS.readSettings);
  ipcMain.removeHandler(IPC_CHANNELS.addCustomScanPath);
  ipcMain.removeHandler(IPC_CHANNELS.removeCustomScanPath);
  ipcMain.removeHandler(IPC_CHANNELS.setPreferredCanonicalSourcePath);
  ipcMain.removeHandler(IPC_CHANNELS.clearPreferredCanonicalSourcePath);
  ipcMain.removeHandler(IPC_CHANNELS.setDevSidebarInventorySourceSwitcherVisible);
  ipcMain.removeHandler(IPC_CHANNELS.completeOnboarding);
  ipcMain.removeHandler(IPC_CHANNELS.ping);

  if (!hasRegisteredInventoryBroadcast) {
    inventoryRuntime.onDidUpdate((snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.inventoryUpdated, snapshot);
      }
    });
    hasRegisteredInventoryBroadcast = true;
  }
  if (!hasRegisteredAuditBroadcast) {
    inventoryRuntime.onDidAuditUpdate((operations) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.auditUpdated, operations);
      }
    });
    hasRegisteredAuditBroadcast = true;
  }

  registerIpcHandler(IPC_CHANNELS.getShellState, () => getAppShellState());
  registerIpcHandler(IPC_CHANNELS.readUpdateStatus, () => getAutoUpdateStatus());
  registerIpcHandler(IPC_CHANNELS.checkForUpdates, () => requestAutoUpdateCheck());
  registerIpcHandler(IPC_CHANNELS.installUpdate, () => installReadyAutoUpdate());
  registerIpcHandler(IPC_CHANNELS.openPathInEditor, async (_event, filePath: string) => {
    const errorMessage = await shell.openPath(resolveOpenPath(filePath));
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
  registerIpcHandler(IPC_CHANNELS.revealPathInFinder, (_event, filePath: string) => {
    shell.showItemInFolder(resolveOpenPath(filePath));
  });
  registerIpcHandler(IPC_CHANNELS.chooseDirectory, async (_event, request?: ChooseDirectoryRequest) => {
    const result = await dialog.showOpenDialog({
      title: request?.title ?? 'Choose directory',
      properties: ['openDirectory', 'createDirectory'],
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.on(IPC_CHANNELS.readInitialInventoryBootstrap, (event) => {
    event.returnValue = readCachedInventorySync(resolveInventoryScanOptions());
  });
  registerIpcHandler(IPC_CHANNELS.readSettings, () => readSettingsState(resolveInventoryScanOptions()));
  registerIpcHandler(IPC_CHANNELS.readCachedInventory, () =>
    inventoryRuntime.readCachedInventory(resolveInventoryScanOptions()),
  );
  registerIpcHandler(IPC_CHANNELS.scanInventory, () =>
    inventoryRuntime.scanInventory(resolveInventoryScanOptions()),
  );
  registerIpcHandler(IPC_CHANNELS.rescanInventory, (_event, request?: RescanInventoryRequest) =>
    triggerInventoryRescan(request),
  );
  registerIpcHandler(IPC_CHANNELS.testMcpConnectivity, () =>
    inventoryRuntime.testMcpConnectivity(resolveInventoryScanOptions()),
  );
  registerIpcHandler(IPC_CHANNELS.cancelMcpConnectivityTest, () => {
    inventoryRuntime.cancelMcpConnectivityTest();
  });
  registerIpcHandler(
    IPC_CHANNELS.addSkill,
    (_event, request: AddSkillRequest) =>
      inventoryRuntime.addSkill(request, resolveInventoryScanOptions()),
  );
  registerIpcHandler(
    IPC_CHANNELS.addMcpServer,
    (_event, request: AddMcpServerRequest) =>
      inventoryRuntime.addMcpServer(request, resolveInventoryScanOptions()),
  );
  registerIpcHandler(
    IPC_CHANNELS.addSubagent,
    (_event, request: AddSubagentRequest) =>
      inventoryRuntime.addSubagent(request, resolveInventoryScanOptions()),
  );
  registerIpcHandler(IPC_CHANNELS.resolveIssue, (_event, request: ResolveIssueRequest) =>
    inventoryRuntime.resolveIssue(request),
  );
  registerIpcHandler(IPC_CHANNELS.applyCapabilityAction, (_event, request: CapabilityActionRequest) =>
    inventoryRuntime.applyCapabilityAction(request, resolveInventoryScanOptions()),
  );
  registerIpcHandler(IPC_CHANNELS.dismissDrift, (_event, request: DismissDriftRequest) =>
    inventoryRuntime.dismissDrift(request),
  );
  registerIpcHandler(IPC_CHANNELS.removeInventoryItem, (_event, request: RemoveInventoryItemRequest) =>
    inventoryRuntime.removeInventoryItem(request, resolveInventoryScanOptions()),
  );
  registerIpcHandler(IPC_CHANNELS.readAuditLog, (_event, options?: { limit?: number }) =>
    inventoryRuntime.readAuditLog(options, resolveInventoryScanOptions()),
  );
  registerIpcHandler(IPC_CHANNELS.undoAuditOperation, async (_event, operationId: string) => ({
    ...await inventoryRuntime.undoAuditOperation(operationId),
    settingsState: await readSettingsState(resolveInventoryScanOptions()),
  }));
  registerIpcHandler(IPC_CHANNELS.releaseStartupObservation, () => {
    inventoryRuntime.releaseStartupObservation();
  });
  if (isDevToolsEnabled()) {
    registerIpcHandler(IPC_CHANNELS.seedRepresentativeFixtures, async () => {
      const { assertSandboxRootSafeForReset, seedRepresentativeFixtures } = await import('@main/sandbox-fixtures');
      const paths = resolveSandboxSkillIndexPaths();
      await assertSandboxRootSafeForReset(paths, { env: process.env });
      const result = await runAuditedIpcOperation({
        kind: 'seed-representative-fixtures',
        title: 'Reset representative sandbox',
        summary: 'Representative sandbox fixtures were reset.',
        sourceMode: 'sandbox',
        entity: { type: 'sandbox' },
        affectedPaths: [paths.sandboxRoot, paths.configFile],
        undoable: false,
      }, () => seedRepresentativeFixtures({ paths, env: process.env }), paths);
      return result;
    });
    registerIpcHandler(IPC_CHANNELS.setInventoryMode, (_event, mode: InventorySourceMode) => setInventoryMode(mode));
  }
  registerIpcHandler(IPC_CHANNELS.addCustomScanPath, (_event, scanPath: string) =>
    runAuditedSettingsOperation('Added custom scan path', (scanOptions) => addCustomScanPath(scanPath, scanOptions)),
  );
  registerIpcHandler(IPC_CHANNELS.removeCustomScanPath, (_event, scanPath: string) =>
    runAuditedSettingsOperation('Removed custom scan path', (scanOptions) => removeCustomScanPath(scanPath, scanOptions)),
  );
  registerIpcHandler(IPC_CHANNELS.setPreferredCanonicalSourcePath, (_event, scanPath: string) =>
    runAuditedSettingsOperation('Set preferred Universal source', (scanOptions) => setPreferredCanonicalSourcePath(scanPath, scanOptions)),
  );
  registerIpcHandler(IPC_CHANNELS.clearPreferredCanonicalSourcePath, () =>
    runAuditedSettingsOperation('Cleared preferred Universal source', (scanOptions) => clearPreferredCanonicalSourcePath(scanOptions)),
  );
  registerIpcHandler(IPC_CHANNELS.setDevSidebarInventorySourceSwitcherVisible, (_event, visible: boolean) =>
    runAuditedGlobalSettingsOperation(
      visible ? 'Show sidebar inventory source switcher' : 'Hide sidebar inventory source switcher',
      (scanOptions) => setDevSidebarInventorySourceSwitcherVisible(visible, scanOptions),
    ),
  );
  registerIpcHandler(IPC_CHANNELS.completeOnboarding, (_event, request: CompleteOnboardingRequest = {}) =>
    runAuditedSettingsOperation('Completed onboarding', (scanOptions) => completeOnboarding(request, scanOptions)),
  );
  registerIpcHandler(IPC_CHANNELS.ping, () => 'pong');
}

function registerIpcHandler<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
): void {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      return serializeIpcError(error);
    }
  });
}

async function runAuditedSettingsOperation<T>(title: string, run: (scanOptions: ReturnType<typeof resolveInventoryScanOptions>) => Promise<T>): Promise<T> {
  const scanOptions = resolveInventoryScanOptions();
  const paths = resolveSkillIndexPathsForScanOptions(scanOptions);
  return runAuditedIpcOperation({
    kind: 'settings-update',
    title,
    summary: 'Skill Index settings changed.',
    sourceMode: resolveAuditSourceMode(),
    entity: { type: 'settings' },
    affectedPaths: [paths.configFile],
    undoable: true,
  }, () => run(scanOptions), paths);
}

async function runAuditedGlobalSettingsOperation<T>(
  title: string,
  run: (scanOptions: ReturnType<typeof resolveInventoryScanOptions>) => Promise<T>,
): Promise<T> {
  const scanOptions = resolveInventoryScanOptions();
  const paths = resolveSkillIndexPaths();
  return runAuditedIpcOperation({
    kind: 'settings-update',
    title,
    summary: 'Skill Index settings changed.',
    sourceMode: 'live',
    entity: { type: 'settings' },
    affectedPaths: [paths.configFile],
    undoable: true,
  }, () => run(scanOptions), paths);
}

async function runAuditedIpcOperation<T>(
  request: AuditOperationRequest,
  run: () => Promise<T>,
  paths: SkillIndexPaths = resolveSkillIndexPathsForScanOptions(resolveInventoryScanOptions()),
): Promise<T> {
  const { result } = await getIpcAuditService(paths).runOperation(request, run);
  broadcastAuditOperations(await getIpcAuditService(paths).readOperations());
  return result;
}

function getIpcAuditService(paths: SkillIndexPaths) {
  const existingService = ipcAuditServicesByLogFile.get(paths.auditLogFile);
  if (existingService) {
    return existingService;
  }

  const service = createAuditLogService({ paths });
  ipcAuditServicesByLogFile.set(paths.auditLogFile, service);
  return service;
}

function broadcastAuditOperations(operations: AuditOperation[]) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.auditUpdated, operations);
  }
}

function resolveAuditSourceMode(): 'sandbox' | 'live' {
  const scanOptions = resolveInventoryScanOptions();
  return scanOptions.includeSandboxSources === true && scanOptions.includeLiveSources === false ? 'sandbox' : 'live';
}

function resolveOpenPath(filePath: string): string {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}
