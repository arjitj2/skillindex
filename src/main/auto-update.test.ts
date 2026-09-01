import { afterEach, describe, expect, it, vi } from 'vitest';

const autoUpdaterMock = vi.hoisted(() => ({
  quitAndInstall: vi.fn(),
}));

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
}));

import {
  AUTO_UPDATE_INSTALL_WATCHDOG_MS,
  STARTUP_UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  configureAutoUpdates,
  consumePendingAutoUpdateRetry,
  dismissAutoUpdateRecovery,
  getAutoUpdateStatus,
  installReadyAutoUpdate,
  requestAutoUpdateCheck,
  retryReadyAutoUpdate,
  shouldEnableAutoUpdates,
  type AutoUpdaterEvent,
  type AutoUpdaterEventMap,
} from './auto-update';

afterEach(() => {
  vi.useRealTimers();
});

describe('auto-update lifecycle', () => {
  it('enables updates only for packaged standard builds', () => {
    expect(shouldEnableAutoUpdates({ buildFlavor: 'standard', isPackaged: true })).toBe(true);
    expect(shouldEnableAutoUpdates({ buildFlavor: 'dev-alpha', isPackaged: true })).toBe(false);
    expect(shouldEnableAutoUpdates({ buildFlavor: 'standard', isPackaged: false })).toBe(false);
    expect(shouldEnableAutoUpdates({
      buildFlavor: 'standard',
      disableAutoUpdate: true,
      isPackaged: true,
    })).toBe(false);
  });

  it('does not schedule update checks when updates are disabled', () => {
    const runtime = createRuntime({ buildFlavor: 'dev-alpha', isPackaged: true });

    expect(configureAutoUpdates(runtime)).toBe(false);
    expect(getAutoUpdateStatus()).toEqual({ phase: 'disabled' });
    expect(runtime.setTimeout).not.toHaveBeenCalled();
    expect(runtime.setInterval).not.toHaveBeenCalled();
    expect(runtime.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('schedules startup and recurring background checks for packaged standard builds', async () => {
    const runtime = createRuntime({ buildFlavor: 'standard', isPackaged: true });

    expect(configureAutoUpdates(runtime)).toBe(true);
    expect(runtime.updater.autoDownload).toBe(true);
    expect(runtime.updater.autoInstallOnAppQuit).toBe(false);
    expect(runtime.setTimeout).toHaveBeenCalledWith(expect.any(Function), STARTUP_UPDATE_CHECK_DELAY_MS);
    expect(runtime.setInterval).toHaveBeenCalledWith(expect.any(Function), UPDATE_CHECK_INTERVAL_MS);

    runtime.scheduledTimeouts[0]?.();
    await Promise.resolve();

    runtime.scheduledIntervals[0]?.();
    await Promise.resolve();

    expect(runtime.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('publishes download progress and ready statuses without a native prompt', () => {
    const runtime = createRuntime({ buildFlavor: 'standard', isPackaged: true });

    configureAutoUpdates(runtime);
    runtime.listeners.get('update-available')?.(createUpdateInfo('0.2.0'));
    const downloadingStatus = getAutoUpdateStatus();
    expect(downloadingStatus.phase).toBe('downloading');
    expect(downloadingStatus.version).toBe('0.2.0');
    expect(downloadingStatus.lastCheckedAt).toEqual(expect.any(String));

    runtime.listeners.get('download-progress')?.({
      bytesPerSecond: 1_024_000,
      delta: 6_600_000,
      percent: 23.5714,
      total: 28_000_000,
      transferred: 6_600_000,
    });
    expect(getAutoUpdateStatus()).toEqual(expect.objectContaining({
      downloadProgress: {
        bytesPerSecond: 1_024_000,
        percent: 23.5714,
        totalBytes: 28_000_000,
        transferredBytes: 6_600_000,
      },
      phase: 'downloading',
      version: '0.2.0',
    }));

    runtime.listeners.get('update-downloaded')?.({
      ...createUpdateInfo('0.2.0'),
      downloadedFile: '/tmp/Skill Index-0.2.0.zip',
    });
    const readyStatus = getAutoUpdateStatus();
    expect(readyStatus.phase).toBe('ready');
    expect(readyStatus.version).toBe('0.2.0');
    expect(readyStatus.lastCheckedAt).toEqual(expect.any(String));
  });

  it('lets the macOS updater settle before installing a newly ready update', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T22:00:00.000Z'));
    const runtime = createRuntime({ buildFlavor: 'standard', isPackaged: true });

    configureAutoUpdates(runtime);
    runtime.listeners.get('update-downloaded')?.({
      ...createUpdateInfo('0.2.0'),
      downloadedFile: '/tmp/Skill Index-0.2.0.zip',
    });

    const installPromise = installReadyAutoUpdate({
      clearTimeout,
      now: () => Date.now(),
      setTimeout,
      updater: runtime.updater,
    });

    expect(runtime.updater.quitAndInstall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_999);
    expect(runtime.updater.quitAndInstall).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await installPromise;
    expect(runtime.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    const installingStatus = getAutoUpdateStatus();
    expect(installingStatus).toMatchObject({
      phase: 'installing',
      version: '0.2.0',
    });
    expect(typeof installingStatus.installStartedAt).toBe('string');

    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INSTALL_WATCHDOG_MS - 1);
    expect(getAutoUpdateStatus().phase).toBe('installing');

    await vi.advanceTimersByTimeAsync(1);
    expect(getAutoUpdateStatus()).toEqual(expect.objectContaining({
      phase: 'recovery',
      version: '0.2.0',
      retryAvailable: true,
    }));
  });

  it('coalesces install requests while the updater is settling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T22:00:00.000Z'));
    const runtime = createRuntime({ buildFlavor: 'standard', isPackaged: true });

    configureAutoUpdates(runtime);
    runtime.listeners.get('update-downloaded')?.({
      ...createUpdateInfo('0.2.0'),
      downloadedFile: '/tmp/Skill Index-0.2.0.zip',
    });
    const installRuntime = {
      clearTimeout,
      now: () => Date.now(),
      setTimeout,
      updater: runtime.updater,
    };

    const firstInstall = installReadyAutoUpdate(installRuntime);
    const secondInstall = installReadyAutoUpdate(installRuntime);
    await vi.advanceTimersByTimeAsync(6_000);
    await Promise.all([firstInstall, secondInstall]);

    expect(runtime.updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('dismisses recovery back to an actionable ready state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T22:00:00.000Z'));
    const runtime = createRuntime({ buildFlavor: 'standard', isPackaged: true });

    configureAutoUpdates(runtime);
    runtime.listeners.get('update-downloaded')?.({
      ...createUpdateInfo('0.2.0'),
      downloadedFile: '/tmp/Skill Index-0.2.0.zip',
    });
    const installPromise = installReadyAutoUpdate({
      clearTimeout,
      now: () => Date.now(),
      setTimeout,
      updater: runtime.updater,
    });
    await vi.advanceTimersByTimeAsync(6_000 + AUTO_UPDATE_INSTALL_WATCHDOG_MS);
    await installPromise;

    expect(dismissAutoUpdateRecovery()).toEqual({
      phase: 'ready',
      version: '0.2.0',
    });
  });

  it('writes a one-shot retry marker before relaunching', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T22:00:00.000Z'));
    const runtime = createRuntime({ buildFlavor: 'standard', isPackaged: true });
    configureAutoUpdates(runtime);
    runtime.listeners.get('update-downloaded')?.({
      ...createUpdateInfo('0.2.0'),
      downloadedFile: '/tmp/Skill Index-0.2.0.zip',
    });
    const installPromise = installReadyAutoUpdate({
      clearTimeout,
      now: () => Date.now(),
      setTimeout,
      updater: runtime.updater,
    });
    await vi.advanceTimersByTimeAsync(6_000 + AUTO_UPDATE_INSTALL_WATCHDOG_MS);
    await installPromise;
    const retryRuntime = createRetryRuntime();

    await retryReadyAutoUpdate(retryRuntime);

    expect(retryRuntime.writeMarker).toHaveBeenCalledWith({
      version: '0.2.0',
      createdAt: '2026-09-01T22:00:21.000Z',
      attemptCount: 1,
    });
    expect(retryRuntime.relaunch).toHaveBeenCalledOnce();
    expect(retryRuntime.exit).toHaveBeenCalledWith(0);
  });

  it('consumes a matching retry marker once before installing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T22:00:00.000Z'));
    const runtime = createRuntime({ buildFlavor: 'standard', isPackaged: true });
    configureAutoUpdates(runtime);
    runtime.listeners.get('update-downloaded')?.({
      ...createUpdateInfo('0.2.0'),
      downloadedFile: '/tmp/Skill Index-0.2.0.zip',
    });
    const retryRuntime = createRetryRuntime({
      marker: {
        version: '0.2.0',
        createdAt: '2026-09-01T21:59:30.000Z',
        attemptCount: 1,
      },
    });
    const installRuntime = {
      clearTimeout,
      now: () => Date.now(),
      setTimeout,
      updater: runtime.updater,
    };

    const consumePromise = consumePendingAutoUpdateRetry('0.2.0', retryRuntime, installRuntime);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(consumePromise).resolves.toBe(true);
    await expect(consumePendingAutoUpdateRetry('0.2.0', retryRuntime, installRuntime)).resolves.toBe(false);

    expect(retryRuntime.removeMarker).toHaveBeenCalledOnce();
    expect(retryRuntime.readMarker).toHaveBeenCalledOnce();
    expect(runtime.updater.quitAndInstall).toHaveBeenCalledOnce();
    expect(getAutoUpdateStatus()).toEqual(expect.objectContaining({
      phase: 'installing',
      retryAvailable: false,
    }));
  });

  it('keeps manual checks disabled until the production updater lifecycle is registered', async () => {
    const runtime = createRuntime({ buildFlavor: 'standard', isPackaged: true });

    configureAutoUpdates(runtime);
    const status = await requestAutoUpdateCheck();

    expect(status).toEqual({ phase: 'disabled' });
    expect(runtime.updater.checkForUpdates).not.toHaveBeenCalled();
  });
});

interface RuntimeOptions {
  buildFlavor: 'standard' | 'dev-alpha';
  isPackaged: boolean;
}

function createRuntime(options: RuntimeOptions) {
  const listeners = createAutoUpdaterListenerRegistry();
  const scheduledTimeouts: Array<() => void> = [];
  const scheduledIntervals: Array<() => void> = [];
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn<() => Promise<null>>().mockResolvedValue(null),
    on: vi.fn(<Event extends AutoUpdaterEvent>(event: Event, listener: AutoUpdaterEventMap[Event]) => {
      listeners.set(event, listener);
      return updater;
    }),
    quitAndInstall: vi.fn(),
  };

  return {
    buildFlavor: options.buildFlavor,
    isPackaged: options.isPackaged,
    listeners,
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    consumePendingRetry: vi.fn().mockResolvedValue(false),
    scheduledIntervals,
    scheduledTimeouts,
    setInterval: vi.fn((callback: () => void) => {
      scheduledIntervals.push(callback);
      return 1;
    }),
    setTimeout: vi.fn((callback: () => void) => {
      scheduledTimeouts.push(callback);
      return 1;
    }),
    updater,
  };
}

function createRetryRuntime(options: {
  marker?: { version: string; createdAt: string; attemptCount: 1 };
} = {}) {
  return {
    exit: vi.fn(),
    now: () => Date.now(),
    readMarker: vi.fn().mockResolvedValue(options.marker ?? null),
    relaunch: vi.fn(),
    removeMarker: vi.fn().mockResolvedValue(undefined),
    writeMarker: vi.fn().mockResolvedValue(undefined),
  };
}

function createAutoUpdaterListenerRegistry() {
  const listeners: Partial<AutoUpdaterEventMap> = {};

  return {
    get<Event extends AutoUpdaterEvent>(event: Event): AutoUpdaterEventMap[Event] | undefined {
      return listeners[event];
    },
    set<Event extends AutoUpdaterEvent>(event: Event, listener: AutoUpdaterEventMap[Event]): void {
      listeners[event] = listener;
    },
  };
}

function createUpdateInfo(version: string): Parameters<AutoUpdaterEventMap['update-available']>[0] {
  return {
    files: [],
    path: '',
    releaseDate: '2026-05-17T00:00:00.000Z',
    sha512: '',
    version,
  };
}
