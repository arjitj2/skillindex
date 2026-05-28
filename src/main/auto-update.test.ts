import { describe, expect, it, vi } from 'vitest';

import {
  STARTUP_UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  configureAutoUpdates,
  getAutoUpdateStatus,
  requestAutoUpdateCheck,
  shouldEnableAutoUpdates,
} from './auto-update';

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
    runtime.listeners.get('update-available')?.({ version: '0.2.0' });
    const downloadingStatus = getAutoUpdateStatus();
    expect(downloadingStatus.phase).toBe('downloading');
    expect(downloadingStatus.version).toBe('0.2.0');
    expect(downloadingStatus.lastCheckedAt).toEqual(expect.any(String));

    runtime.listeners.get('download-progress')?.({
      bytesPerSecond: 1_024_000,
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

    runtime.listeners.get('update-downloaded')?.({ version: '0.2.0' });
    const readyStatus = getAutoUpdateStatus();
    expect(readyStatus.phase).toBe('ready');
    expect(readyStatus.version).toBe('0.2.0');
    expect(readyStatus.lastCheckedAt).toEqual(expect.any(String));
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
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const scheduledTimeouts: Array<() => void> = [];
  const scheduledIntervals: Array<() => void> = [];
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
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
