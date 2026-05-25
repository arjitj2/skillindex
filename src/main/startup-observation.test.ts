// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  STARTUP_SCAN_DELAY_ENV,
  STARTUP_SCAN_HOLD_ENV,
  createStartupObservationAid,
  getStartupScanDelayMs,
  getStartupScanHold,
} from '@main/startup-observation';

describe('startup observation aid', () => {
  it('defaults the launch scan delay to off when the test-only env var is unset or invalid', () => {
    expect(getStartupScanDelayMs({})).toBe(0);
    expect(getStartupScanDelayMs({ [STARTUP_SCAN_DELAY_ENV]: '0' })).toBe(0);
    expect(getStartupScanDelayMs({ [STARTUP_SCAN_DELAY_ENV]: '-25' })).toBe(0);
    expect(getStartupScanDelayMs({ [STARTUP_SCAN_DELAY_ENV]: 'not-a-number' })).toBe(0);
  });

  it('uses the configured test-only launch scan delay once even across concurrent startup scans', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const aid = createStartupObservationAid({
      env: {
        [STARTUP_SCAN_DELAY_ENV]: '250',
      },
      wait,
    });

    await Promise.all([aid.beforeInitialReconciliation(), aid.beforeInitialReconciliation()]);
    await aid.beforeInitialReconciliation();

    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(250);
  });

  it('can explicitly hold startup reconciliation until validation releases it', async () => {
    const aid = createStartupObservationAid({
      env: {
        [STARTUP_SCAN_HOLD_ENV]: 'true',
      },
    });

    let released = false;
    const pending = aid.beforeInitialReconciliation().then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);
    expect(getStartupScanHold({ [STARTUP_SCAN_HOLD_ENV]: 'true' })).toBe(true);

    aid.releaseInitialReconciliation();
    await pending;

    expect(released).toBe(true);
  });
});
