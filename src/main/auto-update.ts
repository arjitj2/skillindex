import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ProgressInfo, UpdateCheckResult, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';

import { getSkillIndexBuildFlavor, type SkillIndexBuildFlavor } from '@shared/build-flavor';
import { IPC_CHANNELS, type AutoUpdateDownloadProgress, type AutoUpdateStatus } from '@shared/contracts';

export const STARTUP_UPDATE_CHECK_DELAY_MS = 5_000;
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;
export const AUTO_UPDATE_INSTALL_SETTLE_DELAY_MS = 6_000;
export const AUTO_UPDATE_INSTALL_WATCHDOG_MS = 15_000;
export const AUTO_UPDATE_RETRY_MARKER_MAX_AGE_MS = 24 * 60 * 60_000;
export const MANUAL_UPDATE_DOWNLOAD_URL = 'https://skillindex.app';
const AUTO_UPDATE_RETRY_MARKER_FILE = 'pending-update-retry.json';

export interface AutoUpdateEligibility {
  buildFlavor: SkillIndexBuildFlavor;
  isPackaged: boolean;
  disableAutoUpdate?: boolean;
}

export interface AutoUpdaterEventMap {
  error: (error: Error, message?: string) => void;
  'checking-for-update': () => void;
  'download-progress': (info: ProgressInfo) => void;
  'update-available': (info: UpdateInfo) => void;
  'update-downloaded': (info: UpdateDownloadedEvent) => void;
  'update-not-available': (info: UpdateInfo) => void;
}

export type AutoUpdaterEvent = keyof AutoUpdaterEventMap;

type TimerHandle = NodeJS.Timeout | number;

interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on<Event extends AutoUpdaterEvent>(event: Event, listener: AutoUpdaterEventMap[Event]): AutoUpdaterLike;
}

interface AutoUpdateRuntime {
  buildFlavor: SkillIndexBuildFlavor;
  disableAutoUpdate?: boolean;
  isPackaged: boolean;
  logger: Pick<Console, 'error' | 'info'>;
  consumePendingRetry: (version: string) => Promise<boolean>;
  setInterval: (callback: () => void, delayMs: number) => TimerHandle;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  updater: AutoUpdaterLike;
}

interface AutoUpdateInstallRuntime {
  clearTimeout: (handle: TimerHandle) => void;
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  updater: Pick<AutoUpdaterLike, 'quitAndInstall'>;
}

export interface AutoUpdateRetryMarker {
  version: string;
  createdAt: string;
  attemptCount: 1;
}

interface AutoUpdateRetryRuntime {
  exit: (exitCode?: number) => void;
  now: () => number;
  readMarker: () => Promise<AutoUpdateRetryMarker | null>;
  relaunch: () => void;
  removeMarker: () => Promise<void>;
  writeMarker: (marker: AutoUpdateRetryMarker) => Promise<void>;
}

let autoUpdateStatus: AutoUpdateStatus = { phase: 'disabled' };
let hasRegisteredAutoUpdater = false;
let hasUpdateCheckInFlight = false;
let autoUpdateReadyAtMs: number | null = null;
let installAttemptPromise: Promise<AutoUpdateStatus> | null = null;
let clearInstallWatchdog: (() => void) | null = null;
let retryConsumedVersion: string | null = null;

export function shouldEnableAutoUpdates(eligibility: AutoUpdateEligibility): boolean {
  return eligibility.isPackaged
    && eligibility.buildFlavor === 'standard'
    && eligibility.disableAutoUpdate !== true;
}

export function getAutoUpdateStatus(): AutoUpdateStatus {
  return autoUpdateStatus;
}

export function configureAutoUpdates(runtime: AutoUpdateRuntime): boolean {
  resetAutoUpdateInstallState();
  autoUpdateReadyAtMs = null;
  retryConsumedVersion = null;
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
      version: info.version,
      lastCheckedAt: new Date().toISOString(),
    });
  });
  runtime.updater.on('download-progress', (info) => {
    setAutoUpdateStatus({
      ...getAutoUpdateStatus(),
      downloadProgress: readDownloadProgress(info),
      phase: 'downloading',
      version: getAutoUpdateStatus().version,
    });
  });
  runtime.updater.on('update-downloaded', (info) => {
    autoUpdateReadyAtMs = Date.now();
    setAutoUpdateStatus({
      phase: 'ready',
      version: info.version,
      lastCheckedAt: new Date().toISOString(),
    });
    void runtime.consumePendingRetry(info.version).catch((error: unknown) => {
      runtime.logger.error('Failed to resume a pending auto-update retry.', error);
    });
  });
  runtime.updater.on('update-not-available', () => {
    setAutoUpdateStatus({
      phase: 'idle',
      lastCheckedAt: new Date().toISOString(),
    });
  });
  runtime.updater.on('error', (error) => {
    resetAutoUpdateInstallState();
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
    consumePendingRetry: (version) => consumePendingAutoUpdateRetry(version),
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

export async function installReadyAutoUpdate(
  runtime: AutoUpdateInstallRuntime = {
    clearTimeout,
    now: Date.now,
    setTimeout,
    updater: autoUpdater,
  },
): Promise<AutoUpdateStatus> {
  if (installAttemptPromise) {
    return installAttemptPromise;
  }
  if (getAutoUpdateStatus().phase !== 'ready') {
    return getAutoUpdateStatus();
  }

  const attempt = performInstallAttempt(runtime);
  installAttemptPromise = attempt;
  try {
    return await attempt;
  } finally {
    if (installAttemptPromise === attempt) {
      installAttemptPromise = null;
    }
  }
}

async function performInstallAttempt(runtime: AutoUpdateInstallRuntime): Promise<AutoUpdateStatus> {

  const settleDelayMs = autoUpdateReadyAtMs === null
    ? 0
    : Math.max(0, AUTO_UPDATE_INSTALL_SETTLE_DELAY_MS - (runtime.now() - autoUpdateReadyAtMs));
  if (settleDelayMs > 0) {
    await new Promise<void>((resolve) => {
      runtime.setTimeout(resolve, settleDelayMs);
    });
  }

  const readyStatus = getAutoUpdateStatus();
  if (readyStatus.phase !== 'ready') {
    return readyStatus;
  }

  const retryAvailable = retryConsumedVersion === readyStatus.version ? false : undefined;
  setAutoUpdateStatus({
    phase: 'installing',
    version: readyStatus.version,
    installStartedAt: new Date(runtime.now()).toISOString(),
    retryAvailable,
  });
  runtime.updater.quitAndInstall(false, true);

  const watchdogHandle = runtime.setTimeout(() => {
    const currentStatus = getAutoUpdateStatus();
    if (currentStatus.phase !== 'installing') {
      return;
    }
    clearInstallWatchdog = null;
    setAutoUpdateStatus({
      phase: 'recovery',
      version: currentStatus.version,
      errorMessage: 'Skill Index did not restart automatically.',
      retryAvailable: retryConsumedVersion !== currentStatus.version,
    });
  }, AUTO_UPDATE_INSTALL_WATCHDOG_MS);
  clearInstallWatchdog = () => runtime.clearTimeout(watchdogHandle);
  return getAutoUpdateStatus();
}

export function dismissAutoUpdateRecovery(): AutoUpdateStatus {
  const currentStatus = getAutoUpdateStatus();
  if (currentStatus.phase !== 'recovery') {
    return currentStatus;
  }

  resetAutoUpdateInstallState();
  setAutoUpdateStatus({
    phase: 'ready',
    version: currentStatus.version,
  });
  return getAutoUpdateStatus();
}

export async function retryReadyAutoUpdate(
  runtime: AutoUpdateRetryRuntime = createDefaultRetryRuntime(),
): Promise<AutoUpdateStatus> {
  const currentStatus = getAutoUpdateStatus();
  if (currentStatus.phase !== 'recovery' || currentStatus.retryAvailable !== true || !currentStatus.version) {
    return currentStatus;
  }

  const marker: AutoUpdateRetryMarker = {
    version: currentStatus.version,
    createdAt: new Date(runtime.now()).toISOString(),
    attemptCount: 1,
  };
  await runtime.writeMarker(marker);
  retryConsumedVersion = currentStatus.version;
  setAutoUpdateStatus({
    phase: 'installing',
    version: currentStatus.version,
    installStartedAt: marker.createdAt,
    retryAvailable: false,
  });
  runtime.relaunch();
  runtime.exit(0);
  return getAutoUpdateStatus();
}

export async function consumePendingAutoUpdateRetry(
  version: string,
  retryRuntime: AutoUpdateRetryRuntime = createDefaultRetryRuntime(),
  installRuntime?: AutoUpdateInstallRuntime,
): Promise<boolean> {
  if (retryConsumedVersion === version) {
    return false;
  }
  const marker = await retryRuntime.readMarker();
  if (!marker) {
    return false;
  }

  const markerAgeMs = retryRuntime.now() - Date.parse(marker.createdAt);
  const isValid = marker.version === version
    && marker.attemptCount === 1
    && Number.isFinite(markerAgeMs)
    && markerAgeMs >= 0
    && markerAgeMs <= AUTO_UPDATE_RETRY_MARKER_MAX_AGE_MS;
  await retryRuntime.removeMarker();
  if (!isValid) {
    return false;
  }

  retryConsumedVersion = version;
  await installReadyAutoUpdate(installRuntime);
  return true;
}

export async function openManualUpdateDownload(): Promise<void> {
  await shell.openExternal(MANUAL_UPDATE_DOWNLOAD_URL);
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
  if (
    hasUpdateCheckInFlight
    || currentStatus.phase === 'downloading'
    || currentStatus.phase === 'ready'
    || currentStatus.phase === 'installing'
    || currentStatus.phase === 'recovery'
  ) {
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

function resetAutoUpdateInstallState(): void {
  clearInstallWatchdog?.();
  clearInstallWatchdog = null;
  installAttemptPromise = null;
}

function createDefaultRetryRuntime(): AutoUpdateRetryRuntime {
  const markerPath = path.join(app.getPath('userData'), AUTO_UPDATE_RETRY_MARKER_FILE);
  return {
    exit: (exitCode) => app.exit(exitCode),
    now: Date.now,
    readMarker: async () => {
      try {
        const value = JSON.parse(await readFile(markerPath, 'utf8')) as unknown;
        return isAutoUpdateRetryMarker(value) ? value : null;
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    relaunch: () => app.relaunch(),
    removeMarker: async () => {
      await rm(markerPath, { force: true });
    },
    writeMarker: async (marker) => {
      await mkdir(path.dirname(markerPath), { recursive: true });
      await writeFile(markerPath, `${JSON.stringify(marker)}\n`, 'utf8');
    },
  };
}

function isAutoUpdateRetryMarker(value: unknown): value is AutoUpdateRetryMarker {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && typeof value.version === 'string'
    && 'createdAt' in value
    && typeof value.createdAt === 'string'
    && 'attemptCount' in value
    && value.attemptCount === 1;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function broadcastAutoUpdateStatus(status: AutoUpdateStatus): void {
  if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') {
    return;
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.updateStatusUpdated, status);
  }
}

function readDownloadProgress(info: ProgressInfo): AutoUpdateDownloadProgress | undefined {
  const downloadProgress = removeUndefinedFields({
    bytesPerSecond: readFiniteNumber(info.bytesPerSecond),
    percent: readFiniteNumber(info.percent),
    totalBytes: readFiniteNumber(info.total),
    transferredBytes: readFiniteNumber(info.transferred),
  });

  return Object.keys(downloadProgress).length > 0 ? downloadProgress : undefined;
}

function readFiniteNumber(value: number): number | undefined {
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
