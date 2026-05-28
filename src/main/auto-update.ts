import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

import { getSkillIndexBuildFlavor, type SkillIndexBuildFlavor } from '@shared/build-flavor';
import { IPC_CHANNELS, type AutoUpdateDownloadProgress, type AutoUpdateStatus } from '@shared/contracts';

export const STARTUP_UPDATE_CHECK_DELAY_MS = 5_000;
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;

export interface AutoUpdateEligibility {
  buildFlavor: SkillIndexBuildFlavor;
  isPackaged: boolean;
  disableAutoUpdate?: boolean;
}

type AutoUpdaterEvent = 'error'
  | 'checking-for-update'
  | 'download-progress'
  | 'update-available'
  | 'update-downloaded'
  | 'update-not-available';

interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: AutoUpdaterEvent, listener: (...args: unknown[]) => void): unknown;
}

interface AutoUpdateRuntime {
  buildFlavor: SkillIndexBuildFlavor;
  disableAutoUpdate?: boolean;
  isPackaged: boolean;
  logger: Pick<Console, 'error' | 'info'>;
  setInterval: (callback: () => void, delayMs: number) => unknown;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  updater: AutoUpdaterLike;
}

let autoUpdateStatus: AutoUpdateStatus = { phase: 'disabled' };
let hasRegisteredAutoUpdater = false;
let hasUpdateCheckInFlight = false;

export function shouldEnableAutoUpdates(eligibility: AutoUpdateEligibility): boolean {
  return eligibility.isPackaged
    && eligibility.buildFlavor === 'standard'
    && eligibility.disableAutoUpdate !== true;
}

export function getAutoUpdateStatus(): AutoUpdateStatus {
  return autoUpdateStatus;
}

export function configureAutoUpdates(runtime: AutoUpdateRuntime): boolean {
  if (!shouldEnableAutoUpdates(runtime)) {
    setAutoUpdateStatus({ phase: 'disabled' });
    return false;
  }

  runtime.updater.autoDownload = true;
  runtime.updater.autoInstallOnAppQuit = false;
  setAutoUpdateStatus({ phase: 'idle' });

  runtime.updater.on('checking-for-update', () => {
    setAutoUpdateStatus({
      ...getAutoUpdateStatus(),
      phase: 'checking',
      errorMessage: undefined,
    });
  });
  runtime.updater.on('update-available', (info) => {
    setAutoUpdateStatus({
      phase: 'downloading',
      version: readUpdateVersion(info),
      lastCheckedAt: new Date().toISOString(),
    });
  });
  runtime.updater.on('download-progress', (info) => {
    setAutoUpdateStatus({
      ...getAutoUpdateStatus(),
      downloadProgress: readDownloadProgress(info),
      phase: 'downloading',
      version: getAutoUpdateStatus().version ?? readUpdateVersion(info),
    });
  });
  runtime.updater.on('update-downloaded', (info) => {
    setAutoUpdateStatus({
      phase: 'ready',
      version: readUpdateVersion(info) ?? getAutoUpdateStatus().version,
      lastCheckedAt: new Date().toISOString(),
    });
  });
  runtime.updater.on('update-not-available', () => {
    setAutoUpdateStatus({
      phase: 'idle',
      lastCheckedAt: new Date().toISOString(),
    });
  });
  runtime.updater.on('error', (error) => {
    runtime.logger.error('Auto-update check failed.', error);
    setAutoUpdateStatus({
      ...getAutoUpdateStatus(),
      phase: 'error',
      errorMessage: error instanceof Error ? error.message : 'Update check failed.',
      lastCheckedAt: new Date().toISOString(),
    });
  });

  runtime.setTimeout(() => {
    void checkForAutoUpdates(runtime.updater, runtime.logger);
  }, STARTUP_UPDATE_CHECK_DELAY_MS);
  runtime.setInterval(() => {
    void checkForAutoUpdates(runtime.updater, runtime.logger);
  }, UPDATE_CHECK_INTERVAL_MS);

  runtime.logger.info('Auto-update background checks enabled.');
  return true;
}

export function registerAutoUpdateLifecycle(): boolean {
  if (hasRegisteredAutoUpdater) {
    return true;
  }

  const didRegister = configureAutoUpdates({
    buildFlavor: getSkillIndexBuildFlavor(),
    disableAutoUpdate: process.env.SKILL_INDEX_DISABLE_AUTO_UPDATE === '1',
    isPackaged: app.isPackaged,
    logger: console,
    setInterval,
    setTimeout,
    updater: autoUpdater,
  });
  hasRegisteredAutoUpdater = didRegister;
  return didRegister;
}

export async function requestAutoUpdateCheck(): Promise<AutoUpdateStatus> {
  if (!hasRegisteredAutoUpdater) {
    setAutoUpdateStatus({ phase: 'disabled' });
    return getAutoUpdateStatus();
  }

  await checkForAutoUpdates(autoUpdater, console);
  return getAutoUpdateStatus();
}

export function installReadyAutoUpdate(): AutoUpdateStatus {
  if (getAutoUpdateStatus().phase !== 'ready') {
    return getAutoUpdateStatus();
  }

  autoUpdater.quitAndInstall(false, true);
  return getAutoUpdateStatus();
}

function setAutoUpdateStatus(status: AutoUpdateStatus): void {
  autoUpdateStatus = removeUndefinedStatusFields(status);
  broadcastAutoUpdateStatus(autoUpdateStatus);
}

async function checkForAutoUpdates(
  updater: Pick<AutoUpdaterLike, 'checkForUpdates'>,
  logger: Pick<Console, 'error'>,
): Promise<void> {
  const currentStatus = getAutoUpdateStatus();
  if (hasUpdateCheckInFlight || currentStatus.phase === 'downloading' || currentStatus.phase === 'ready') {
    return;
  }

  hasUpdateCheckInFlight = true;
  try {
    await updater.checkForUpdates();
  } catch (error) {
    logger.error('Auto-update check failed.', error);
    setAutoUpdateStatus({
      ...getAutoUpdateStatus(),
      phase: 'error',
      errorMessage: error instanceof Error ? error.message : 'Update check failed.',
      lastCheckedAt: new Date().toISOString(),
    });
  } finally {
    hasUpdateCheckInFlight = false;
  }
}

function broadcastAutoUpdateStatus(status: AutoUpdateStatus): void {
  if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') {
    return;
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.updateStatusUpdated, status);
  }
}

function readUpdateVersion(info: unknown): string | undefined {
  if (!info || typeof info !== 'object' || !('version' in info)) {
    return undefined;
  }

  const version = (info as { version?: unknown }).version;
  return typeof version === 'string' ? version : undefined;
}

function readDownloadProgress(info: unknown): AutoUpdateDownloadProgress | undefined {
  if (!info || typeof info !== 'object') {
    return undefined;
  }

  const downloadProgress = removeUndefinedFields({
    bytesPerSecond: readFiniteNumberField(info, 'bytesPerSecond'),
    percent: readFiniteNumberField(info, 'percent'),
    totalBytes: readFiniteNumberField(info, 'total'),
    transferredBytes: readFiniteNumberField(info, 'transferred'),
  });

  return Object.keys(downloadProgress).length > 0 ? downloadProgress : undefined;
}

function readFiniteNumberField(source: object, field: string): number | undefined {
  const value = (source as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function removeUndefinedStatusFields(status: AutoUpdateStatus): AutoUpdateStatus {
  return removeUndefinedFields(status) as AutoUpdateStatus;
}

function removeUndefinedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as Partial<T>;
}
