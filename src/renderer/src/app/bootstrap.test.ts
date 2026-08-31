import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SkillIndexDesktopApi } from '@shared/contracts';
import { getDesktopApi } from './bootstrap';

describe('getDesktopApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores the complete trace after an IPC error crosses contextBridge', async () => {
    const trace = [
      'Error: Failed to parse Skill Index config.',
      '    at scanInventory (src/main/scan-inventory.ts:42:7)',
      '    at refreshInventory (src/main/inventory-runtime.ts:318:11)',
    ].join('\n');
    const bridgedApi = Object.freeze({
      rescanInventory: vi.fn().mockResolvedValue({
        __skillIndexIpcError: true,
        message: 'Failed to parse Skill Index config.',
        trace,
      }),
    }) as unknown as SkillIndexDesktopApi;
    Object.defineProperty(window, 'skillIndex', {
      configurable: true,
      value: bridgedApi,
    });

    const error = await getDesktopApi().rescanInventory().catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: 'Failed to parse Skill Index config.',
      stack: trace,
    });
  });
});
