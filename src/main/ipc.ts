import os from 'node:os';
import path from 'node:path';

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';

import {
  type AddMcpServerRequest,
  type AddSkillRequest,
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

  ipcMain.handle(IPC_CHANNELS.getShellState, () => getAppShellState());
  ipcMain.handle(IPC_CHANNELS.readUpdateStatus, () => getAutoUpdateStatus());
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, () => requestAutoUpdateCheck());
  ipcMain.handle(IPC_CHANNELS.installUpdate, () => installReadyAutoUpdate());
  ipcMain.handle(IPC_CHANNELS.openPathInEditor, async (_event, filePath: string) => {
    const errorMessage = await shell.openPath(resolveOpenPath(filePath));
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
  ipcMain.handle(IPC_CHANNELS.revealPathInFinder, (_event, filePath: string) => {
    shell.showItemInFolder(resolveOpenPath(filePath));
  });
  ipcMain.handle(IPC_CHANNELS.chooseDirectory, async (_event, request?: ChooseDirectoryRequest) => {
    const result = await dialog.showOpenDialog({
      title: request?.title ?? 'Choose directory',
      properties: ['openDirectory', 'createDirectory'],
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.on(IPC_CHANNELS.readInitialInventoryBootstrap, (event) => {
    event.returnValue = readCachedInventorySync(resolveInventoryScanOptions());
  });
  ipcMain.handle(IPC_CHANNELS.readSettings, () => readSettingsState(resolveInventoryScanOptions()));
  ipcMain.handle(IPC_CHANNELS.readCachedInventory, () =>
    inventoryRuntime.readCachedInventory(resolveInventoryScanOptions()),
  );
  ipcMain.handle(IPC_CHANNELS.scanInventory, () =>
    inventoryRuntime.scanInventory(resolveInventoryScanOptions()),
  );
  ipcMain.handle(IPC_CHANNELS.rescanInventory, (_event, request?: RescanInventoryRequest) =>
    triggerInventoryRescan(request),
  );
  ipcMain.handle(IPC_CHANNELS.testMcpConnectivity, () =>
    inventoryRuntime.testMcpConnectivity(resolveInventoryScanOptions()),
  );
  ipcMain.handle(IPC_CHANNELS.cancelMcpConnectivityTest, () => {
    inventoryRuntime.cancelMcpConnectivityTest();
  });
  ipcMain.handle(
    IPC_CHANNELS.addSkill,
    (_event, request: AddSkillRequest) =>
      inventoryRuntime.addSkill(request, resolveInventoryScanOptions()),
  );
  ipcMain.handle(
    IPC_CHANNELS.addMcpServer,
    (_event, request: AddMcpServerRequest) =>
      inventoryRuntime.addMcpServer(request, resolveInventoryScanOptions()),
  );
  ipcMain.handle(IPC_CHANNELS.resolveIssue, (_event, request: ResolveIssueRequest) =>
    inventoryRuntime.resolveIssue(request),
  );
  ipcMain.handle(IPC_CHANNELS.applyCapabilityAction, (_event, request: CapabilityActionRequest) =>
    inventoryRuntime.applyCapabilityAction(request, resolveInventoryScanOptions()),
  );
  ipcMain.handle(IPC_CHANNELS.dismissDrift, (_event, request: DismissDriftRequest) =>
    inventoryRuntime.dismissDrift(request),
  );
  ipcMain.handle(IPC_CHANNELS.removeInventoryItem, (_event, request: RemoveInventoryItemRequest) =>
    inventoryRuntime.removeInventoryItem(request, resolveInventoryScanOptions()),
  );
  ipcMain.handle(IPC_CHANNELS.readAuditLog, (_event, options?: { limit?: number }) =>
    inventoryRuntime.readAuditLog(options, resolveInventoryScanOptions()),
  );
  ipcMain.handle(IPC_CHANNELS.undoAuditOperation, async (_event, operationId: string) => ({
    ...await inventoryRuntime.undoAuditOperation(operationId),
    settingsState: await readSettingsState(resolveInventoryScanOptions()),
  }));
  ipcMain.handle(IPC_CHANNELS.releaseStartupObservation, () => {
    inventoryRuntime.releaseStartupObservation();
  });
  if (isDevToolsEnabled()) {
    ipcMain.handle(IPC_CHANNELS.seedRepresentativeFixtures, async () => {
      const { seedRepresentativeFixtures } = await import('@main/sandbox-fixtures');
      const paths = resolveSandboxSkillIndexPaths();
      const result = await runAuditedIpcOperation({
        kind: 'seed-representative-fixtures',
        title: 'Reset representative sandbox',
        summary: 'Representative sandbox fixtures were reset.',
        sourceMode: 'sandbox',
        entity: { type: 'sandbox' },
        affectedPaths: [paths.sandboxRoot, paths.configFile],
        undoable: false,
      }, () => seedRepresentativeFixtures({ env: process.env }), paths);
      return result;
    });
    ipcMain.handle(IPC_CHANNELS.setInventoryMode, (_event, mode: InventorySourceMode) => setInventoryMode(mode));
  }
  ipcMain.handle(IPC_CHANNELS.addCustomScanPath, (_event, scanPath: string) =>
    runAuditedSettingsOperation('Added custom scan path', (scanOptions) => addCustomScanPath(scanPath, scanOptions)),
  );
  ipcMain.handle(IPC_CHANNELS.removeCustomScanPath, (_event, scanPath: string) =>
    runAuditedSettingsOperation('Removed custom scan path', (scanOptions) => removeCustomScanPath(scanPath, scanOptions)),
  );
  ipcMain.handle(IPC_CHANNELS.setPreferredCanonicalSourcePath, (_event, scanPath: string) =>
    runAuditedSettingsOperation('Set preferred Universal source', (scanOptions) => setPreferredCanonicalSourcePath(scanPath, scanOptions)),
  );
  ipcMain.handle(IPC_CHANNELS.clearPreferredCanonicalSourcePath, () =>
    runAuditedSettingsOperation('Cleared preferred Universal source', (scanOptions) => clearPreferredCanonicalSourcePath(scanOptions)),
  );
  ipcMain.handle(IPC_CHANNELS.setDevSidebarInventorySourceSwitcherVisible, (_event, visible: boolean) =>
    runAuditedGlobalSettingsOperation(
      visible ? 'Show sidebar inventory source switcher' : 'Hide sidebar inventory source switcher',
      (scanOptions) => setDevSidebarInventorySourceSwitcherVisible(visible, scanOptions),
    ),
  );
  ipcMain.handle(IPC_CHANNELS.completeOnboarding, (_event, request: CompleteOnboardingRequest = {}) =>
    runAuditedSettingsOperation('Completed onboarding', (scanOptions) => completeOnboarding(request, scanOptions)),
  );
  ipcMain.handle(IPC_CHANNELS.ping, () => 'pong');
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
